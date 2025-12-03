# AI Document Chat

AWS Bedrock의 Nova Sonic을 활용한 실시간 음성 기반 문서 질의응답 애플리케이션

## 🚀 빠른 시작

### 1. 환경 변수 설정

`.env.local` 파일을 생성하고 다음 변수를 설정하세요:

```env
# AWS Configuration
AWS_REGION=us-east-1

# S3 Configuration
S3_BUCKET=your-bucket-name

# DynamoDB Configuration
DYNAMODB_TABLE_NAME=ai-doc-chat-documents

# Bedrock Knowledge Base Configuration
BEDROCK_KB_ID=your-knowledge-base-id
BEDROCK_DATA_SOURCE_ID=your-data-source-id

# SQS Queue Configuration
SQS_INGESTION_QUEUE_URL=https://sqs.us-east-1.amazonaws.com/YOUR-ACCOUNT-ID/ai-doc-chat-ingestion-queue

# Upstage API Configuration
UPSTAGE_API_KEY=your-upstage-api-key

# Next.js Configuration
NEXT_PUBLIC_WS_URL=ws://localhost:3000
```

### 2. AWS 인프라 설정

문서 처리 파이프라인을 위한 SQS 큐를 생성하세요:

```bash
# DLQ 생성
aws sqs create-queue \
  --queue-name ai-doc-chat-ingestion-dlq \
  --attributes '{"MessageRetentionPeriod":"1209600"}' \
  --region us-east-1

# DLQ ARN 확인
DLQ_ARN=$(aws sqs get-queue-attributes \
  --queue-url https://sqs.us-east-1.amazonaws.com/YOUR-ACCOUNT-ID/ai-doc-chat-ingestion-dlq \
  --attribute-names QueueArn \
  --query 'Attributes.QueueArn' \
  --output text \
  --region us-east-1)

# 메인 큐 생성
aws sqs create-queue \
  --queue-name ai-doc-chat-ingestion-queue \
  --attributes "{
    \"MessageRetentionPeriod\":\"86400\",
    \"VisibilityTimeout\":\"900\",
    \"ReceiveMessageWaitTimeSeconds\":\"20\",
    \"RedrivePolicy\":\"{\\\"deadLetterTargetArn\\\":\\\"$DLQ_ARN\\\",\\\"maxReceiveCount\\\":\\\"3\\\"}\"
  }" \
  --region us-east-1
```

### 3. 설치 및 실행

```bash
# 의존성 설치
npm install

# 개발 모드로 실행
npm run dev        # 웹 서버 + WebSocket (터미널 1)
npm run dev:worker # 문서 처리 워커 (터미널 2)
```

## 📋 주요 기능

### 1. 문서 업로드 및 처리

- **비동기 파이프라인**: SQS를 사용한 대기열 기반 처리
- **상태 추적**: `uploading` → `parsing` → `parsed` → `ingesting` → `ready`
- **자동 재시도**: 실패 시 최대 3회 재시도 (지수 백오프)
- **타임아웃 관리**: Upstage 파싱 3분, AWS SDK 요청 60초

### 2. 실시간 음성 채팅

- **Nova Sonic**: AWS Bedrock의 음성-텍스트 통합 모델
- **양방향 스트리밍**: 실시간 음성 입출력
- **Tool Use**: 문서 검색 함수 호출

### 3. Knowledge Base 검색

- **RAG**: Bedrock Knowledge Base 기반 문서 검색
- **필터링**: 특정 문서에서만 검색 가능
- **스트리밍 응답**: SSE를 통한 실시간 답변

## 🏗️ 아키텍처

### 문서 처리 파이프라인

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
   │   └─> DynamoDB: status = parsing → parsed
   │
   ├─> S3 업로드 (parsed content)
   │
   ├─> Bedrock KB Ingestion 시작
   │   └─> DynamoDB: status = ingesting
   │
   └─> 성공 시 SQS 메시지 삭제
       실패 시 재시도 → DLQ
```

### 디렉터리 구조

```
ai-doc-chat/
├── app/
│   ├── api/
│   │   ├── chat/              # SSE 기반 텍스트 채팅
│   │   ├── documents/         # 문서 관리 API
│   │   └── upload/            # 업로드 API
│   ├── layout.tsx
│   └── page.tsx
├── components/
│   ├── ChatArea.tsx           # 채팅 UI
│   ├── DocumentSidebar.tsx    # 문서 목록
│   └── EmptyState.tsx
├── lib/
│   ├── services/
│   │   ├── bedrock-service.ts     # Bedrock KB & Chat
│   │   ├── dynamodb-service.ts    # 문서 메타데이터
│   │   ├── s3-service.ts          # S3 업로드
│   │   ├── sqs-service.ts         # SQS 메시지 큐
│   │   └── upstage-service.ts     # PDF 파싱
│   ├── voice/
│   │   ├── client.ts          # Nova Sonic 클라이언트
│   │   ├── server.ts          # WebSocket 서버
│   │   └── session.ts         # 세션 관리
│   └── hooks/
│       ├── useChat.ts         # 텍스트 채팅 훅
│       ├── useDocuments.ts    # 문서 관리 훅
│       └── useVoiceChat.ts    # 음성 채팅 훅
├── workers/
│   └── ingestion-runner.ts    # 문서 처리 워커
├── types/
│   └── index.ts               # TypeScript 타입 정의
└── server-voice.mjs           # 커스텀 Next.js 서버
```

## 🔧 개발 가이드

### 워커 실행 방법

**개발 모드** (hot reload):
```bash
npm run dev:worker
```

**프로덕션 모드**:
```bash
npm run worker
```

### 로그 확인

워커 로그는 `[Worker]` 접두사로 시작합니다:

```
[Worker] 🚀 Starting ingestion worker...
[Worker] Received 1 message(s)
[Worker] Processing document abc-123 (example.pdf)
[Worker] Status: parsing - abc-123
[Worker] Parsed abc-123: 10 pages, 3 tables
[Worker] Status: parsed - abc-123
[Worker] Uploading parsed content for abc-123...
[Worker] Starting KB ingestion for abc-123...
[Worker] Status: ingesting - abc-123 (Job: job-xyz)
[Worker] ✅ Successfully processed abc-123
```

### 에러 처리

1. **재시도 가능한 에러**: 자동으로 3회 재시도 (1s, 2s, 5s 백오프)
2. **재시도 실패**: SQS가 자동으로 DLQ로 이동
3. **DLQ 확인**:
   ```bash
   aws sqs receive-message \
     --queue-url https://sqs.us-east-1.amazonaws.com/YOUR-ACCOUNT-ID/ai-doc-chat-ingestion-dlq \
     --region us-east-1
   ```

### 문서 상태 확인

```bash
# DynamoDB에서 문서 상태 확인
aws dynamodb get-item \
  --table-name ai-doc-chat-documents \
  --key '{"id": {"S": "your-doc-id"}}' \
  --region us-east-1
```

## 📊 모니터링

### CloudWatch Metrics (예정)

- `IngestionQueue/ApproximateNumberOfMessages`: 큐 깊이
- `IngestionQueue/NumberOfMessagesSent`: 전송된 메시지 수
- `IngestionQueue/NumberOfMessagesReceived`: 수신된 메시지 수
- `Worker/ProcessingTime`: 처리 시간
- `Worker/FailureRate`: 실패율

### 로그 검색 (CloudWatch Logs Insights)

```sql
fields @timestamp, @message
| filter @message like /\[Worker\]/
| sort @timestamp desc
| limit 100
```

## 🐛 트러블슈팅

### 워커가 메시지를 처리하지 않음

1. SQS 큐 URL이 환경 변수에 올바르게 설정되었는지 확인
2. AWS 자격 증명이 올바른지 확인
3. 워커 로그에서 에러 메시지 확인

### Upstage 파싱 타임아웃

- 기본값: 180초 (3분)
- 조정: `.env.local`에 `UPSTAGE_TIMEOUT_MS=300000` 추가 (5분)

### DLQ에 메시지가 쌓임

- DLQ 메시지 확인
- 원인 분석 후 수동으로 재처리하거나 삭제
- 필요 시 코드 수정 후 재배포

## 📝 리팩토링 로그

상세한 리팩토링 내역은 [REFACTORING_LOG.md](./REFACTORING_LOG.md)를 참조하세요.

개선 계획 및 가이드는 [README-improvements.md](./README-improvements.md)를 참조하세요.

## 🤝 기여

개선 제안 및 이슈는 언제든 환영합니다!

## 📄 라이센스

MIT License

