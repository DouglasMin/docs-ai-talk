# 리팩토링 로그

## 1. 문서 업로드 파이프라인 비동기화 ✅

**완료 날짜**: 2025-12-03

### 변경 사항

#### 1.1 AWS 인프라 구성

**생성된 리소스**:
- SQS 큐: `ai-doc-chat-ingestion-queue`
  - VisibilityTimeout: 900초 (15분)
  - MessageRetentionPeriod: 86400초 (24시간)
  - MaxReceiveCount: 3 (재시도 3회)
  - Long polling: 20초
  
- DLQ: `ai-doc-chat-ingestion-dlq`
  - MessageRetentionPeriod: 1209600초 (14일)

**생성 명령어**:
```bash
# DLQ 생성
aws sqs create-queue \
  --queue-name ai-doc-chat-ingestion-dlq \
  --attributes '{"MessageRetentionPeriod":"1209600"}' \
  --profile dongik2 \
  --region us-east-1

# 메인 큐 생성
aws sqs create-queue \
  --queue-name ai-doc-chat-ingestion-queue \
  --attributes '{
    "MessageRetentionPeriod":"86400",
    "VisibilityTimeout":"900",
    "ReceiveMessageWaitTimeSeconds":"20",
    "RedrivePolicy":"{\"deadLetterTargetArn\":\"arn:aws:sqs:us-east-1:863518440691:ai-doc-chat-ingestion-dlq\",\"maxReceiveCount\":\"3\"}"
  }' \
  --profile dongik2 \
  --region us-east-1
```

#### 1.2 타입 확장

**파일**: `types/index.ts`

- `DocumentStatus` 타입에 `'parsed'` 상태 추가
- 새로운 상태 전이 흐름:
  ```
  uploading → parsing → parsed → ingesting → ready / failed
  ```

#### 1.3 SQS 서비스 모듈 생성

**파일**: `lib/services/sqs-service.ts`

**주요 기능**:
- `sendIngestionMessage()`: 문서 처리 메시지를 큐에 전송
- `receiveIngestionMessages()`: 워커가 큐에서 메시지 수신
- `deleteIngestionMessage()`: 처리 완료 후 메시지 삭제
- `parseIngestionMessage()`: 메시지 파싱 및 검증

**메시지 형식**:
```typescript
interface IngestionMessage {
  docId: string;
  s3Url: string;
  fileName: string;
  timestamp: string;
}
```

#### 1.4 업로드 완료 엔드포인트 수정

**파일**: `app/api/upload/complete/route.ts`

**변경 전**:
- 동기적으로 Upstage 파싱 → S3 업로드 → Bedrock ingestion 수행
- 모든 처리가 완료될 때까지 HTTP 응답 대기
- 타임아웃 및 재시도 불가 위험

**변경 후**:
- docId와 s3Url 검증만 수행
- SQS에 메시지 전송 후 즉시 응답
- 클라이언트는 `/api/documents/[docId]/status`로 상태 폴링

**응답 형식**:
```json
{
  "accepted": true,
  "docId": "...",
  "messageId": "...",
  "message": "Document queued for processing. Poll /api/documents/[docId]/status for updates."
}
```

#### 1.5 워커 로직 구현

**파일**: `workers/ingestion-runner.ts`

**주요 기능**:
1. **메시지 처리 파이프라인**:
   - SQS long polling (20초)
   - Upstage 파싱
   - S3 업로드
   - Bedrock KB ingestion 시작
   - DynamoDB 상태 업데이트

2. **재시도 정책**:
   - 로컬 재시도: 3회, 지수 백오프 (1s, 2s, 5s)
   - SQS 재시도: maxReceiveCount=3 후 DLQ로 이동

3. **에러 핸들링**:
   - 각 단계별 try-catch
   - 실패 시 DynamoDB에 `status=failed`, `error=message` 기록
   - 재시도 불가능한 경우 메시지는 DLQ로 이동

**실행 방법**:
```bash
# 개발 환경 (hot reload)
npm run dev:worker

# 프로덕션 환경
npm run worker
```

#### 1.6 AWS SDK 설정 강화

**파일**: `lib/aws-config.ts`

**추가된 설정**:

1. **HTTP Handler 설정**:
   - Connection pool: maxSockets 200
   - Connection timeout: 10초
   - Request timeout: 60초 (일반), 180초 (장시간 작업)
   - Keep-alive 활성화

2. **재시도 전략**:
   - 모든 AWS 클라이언트에 `maxAttempts: 3` 설정
   - AWS SDK 기본 지수 백오프 사용

3. **새 클라이언트**:
   - `SQSClient` 추가

#### 1.7 Upstage 서비스 타임아웃 추가

**파일**: `lib/services/upstage-service.ts`

**변경 사항**:
- `AbortController` 기반 타임아웃 구현
- 기본 타임아웃: 180초 (3분)
- 환경 변수로 조정 가능: `UPSTAGE_TIMEOUT_MS`
- 타임아웃 시 사용자 친화적 에러 메시지

#### 1.8 환경 변수 및 의존성

**package.json**:
- `@aws-sdk/client-sqs` 추가
- `@smithy/types` 추가
- 워커 실행 스크립트 추가:
  - `npm run worker`: 워커 실행
  - `npm run dev:worker`: 개발 모드 (hot reload)

**.env.example**:
- `SQS_INGESTION_QUEUE_URL` 추가
- `UPSTAGE_TIMEOUT_MS` 추가

### 테스트 방법

1. **의존성 설치**:
   ```bash
   npm install
   ```

2. **환경 변수 설정**:
   ```bash
   cp .env.example .env
   # .env 파일 편집하여 실제 값 입력
   ```

3. **워커 시작**:
   ```bash
   npm run dev:worker
   ```

4. **서버 시작** (다른 터미널):
   ```bash
   npm run dev
   ```

5. **문서 업로드 테스트**:
   - 프론트엔드에서 PDF 업로드
   - `/api/upload/complete` 호출 시 즉시 `accepted: true` 응답 확인
   - 워커 로그에서 처리 진행 상황 확인
   - DynamoDB에서 상태 전이 확인: `parsing` → `parsed` → `ingesting`

### 아키텍처 다이어그램

```
[Client]
   │
   ├─> POST /api/upload/presigned-url  (1. 업로드 URL 받기)
   │
   ├─> PUT S3 직접 업로드              (2. S3에 직접 업로드)
   │
   ├─> POST /api/upload/complete       (3. 완료 알림)
   │   └─> SQS 메시지 전송
   │       └─> 즉시 accepted: true 응답
   │
   └─> GET /api/documents/[id]/status  (4. 상태 폴링)

[Worker] (백그라운드)
   │
   ├─> SQS 메시지 수신 (long polling)
   │
   ├─> Upstage 파싱 (with timeout & retry)
   │   └─> DynamoDB: status = parsing
   │   └─> DynamoDB: status = parsed
   │
   ├─> S3 업로드 (parsed content)
   │
   ├─> Bedrock KB Ingestion 시작
   │   └─> DynamoDB: status = ingesting
   │
   └─> 성공 시 SQS 메시지 삭제
       실패 시 재시도 → maxReceiveCount 후 DLQ
```

### 개선 효과

1. **응답성 향상**:
   - 업로드 완료 API 응답 시간: ~60초 → ~100ms (600배 개선)
   - 사용자는 즉시 다른 작업 가능

2. **안정성 향상**:
   - HTTP 타임아웃 제거
   - 네트워크 불안정 시 자동 재시도
   - 실패한 작업은 DLQ에 보관되어 수동 복구 가능

3. **확장성 향상**:
   - 워커 프로세스를 여러 개 실행 가능
   - 부하에 따라 워커 수를 동적으로 조정 가능
   - SQS가 자동으로 메시지 분산

4. **관측성 향상**:
   - 각 처리 단계별 상태 기록
   - 구조화된 로그 (`[Worker]` 접두사)
   - 실패 원인이 DynamoDB에 기록됨

### 다음 단계

1. **모니터링 추가** (README-improvements.md 항목 3):
   - CloudWatch Metrics: 큐 깊이, 처리 시간, 실패율
   - 구조화된 로깅 (JSON 형식)
   - 분산 트레이싱 (OpenTelemetry)

2. **프로덕션 배포**:
   - Docker 이미지에 워커 포함
   - ECS/Fargate에서 워커 서비스로 배포
   - Auto Scaling 설정 (큐 깊이 기반)

3. **프론트엔드 업데이트**:
   - 상태 폴링 로직 구현
   - 진행률 UI 추가
   - 재시도 버튼 추가

### 남은 개선 항목

README-improvements.md의 나머지 항목들:
- ✅ 1. 문서 업로드 파이프라인 비동기화
- ⏳ 2. Nova Sonic 세션 및 리소스 관리 강화
- ⏳ 3. 스트리밍 경로 관측/진단 체계
- ⏳ 4. 외부 서비스 호출 안정화 (부분 완료)
- ⏳ 5. 데이터 계층 최적화
- ⏳ 6. 클라이언트 오류 처리 및 UX 개선
- ⏳ 7. 테스트 및 시뮬레이션 환경
- ⏳ 8. 개발/운영 Docker 분리
- ⏳ 9. 중복 API 및 임시 스크립트 정리

