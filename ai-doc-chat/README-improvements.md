## AI Doc Chat 개선 가이드

이 문서는 `AI Doc Chat` 애플리케이션의 핵심 개선 과제를 다른 AI/개발 도구가 그대로 따라갈 수 있도록 상세 단계로 정리한 것입니다. 회원·보안 기능은 제외했으며, 각 항목은 중요도 기준으로 정렬되어 있습니다.

---

### 1. 문서 업로드 파이프라인 비동기화
- **문제**: `POST /api/upload/complete`에서 Upstage 파싱 → S3 저장 → Bedrock ingestion까지 모두 한 HTTP 요청에서 동기로 수행한다. 요청 타임아웃·재시도 불가·리소스 경합 위험이 있다.
- **목표**: 업로드 완료 이벤트를 큐에 넣고 워커가 비동기 처리하도록 리팩터링. 사용자는 즉시 응답을 받고, 파이프라인 상태는 폴링/웹훅으로 조회.
- **가이드라인**
  1. `upload/complete` 엔드포인트는 `docId`, `s3Url`만 검증한 뒤 SQS(또는 다른 큐)에 작업 메시지를 넣고 즉시 `{ accepted: true }`를 반환한다.
  2. 새 `workers/ingestion-runner.ts`(혹은 lambda)에서 큐 메시지를 읽어 Upstage 파싱, `uploadParsedContent`, `startIngestion`을 순차 실행한다.
  3. 워커는 각 단계별 `status`와 `metadata`를 DynamoDB에 업데이트한다. 업로드 단계별 상태 전이를 정의(예: `uploading → parsing → parsed → ingesting → ready / failed`).
  4. 재시도 정책: 큐 재시도(예: 3회) + 지수 백오프를 설정하고, 실패 시 `status=failed`, `error=reason`을 기록한다.
  5. README에 “업로드 완료 후 status polling” 절차를 문서화하고, 프론트엔드가 상태를 주기적으로 확인하도록 API 명세를 업데이트한다.

---

### 2. Nova Sonic 세션 및 리소스 관리 강화
- **문제**: `NovaSession` 큐에 크기 제한이 없고 WebSocket 종료 시 즉시 정리되지 않는다. 길어진 세션에서 메모리·CPU가 폭증할 위험이 있다.
- **목표**: 세션 수명 주기, 큐 제한, back-pressure를 정의해 안정적인 장시간 스트리밍을 지원.
- **가이드라인**
  1. `NovaSession`에 `MAX_AUDIO_QUEUE`, `MAX_TOOL_QUEUE` 상수를 도입해 큐 초과 시 가장 오래된 항목 제거 또는 클라이언트에 “slow consumer” 에러를 전송.
  2. `handleVoiceConnection`에서 WebSocket `ping/pong`과 유휴 타임아웃(예: 60초 무음) 감지 후 `session.stop()` 호출.
  3. `NovaClient.startStream`이 반환하는 Promise를 호출부에서 추적하고, WebSocket 종료 시 `AbortController`나 커스텀 flag로 Bedrock 스트림을 취소.
  4. 세션 메트릭(생성 시간, 전송된 오디오/텍스트 청크 수, 툴 호출 횟수)을 구조화 로그로 남겨 추후 관측 가능하게 한다.
  5. 음성 입력 속도가 모델 처리 속도보다 빠른 경우를 대비해 클라이언트에 `throttle` 이벤트를 전송하는 프로토콜을 정의한다.

---

### 3. 스트리밍 경로 관측/진단 체계
- **문제**: SSE·WebSocket 경로에 헬스체크, 메트릭, 추적 ID가 없어 장애 분석이 어렵다.
- **목표**: 스트리밍 전용 로깅 및 모니터링 훅을 추가해 원인 추적 시간을 단축.
- **가이드라인**
  1. 공통 `logger` 유틸을 만들고 `sessionId`, `requestId`, `docId` 등을 MDC(context)로 묶어 로그마다 포함.
  2. SSE 응답(`app/api/chat/route.ts`)에 연결 ID를 발급하고, 클라이언트는 이 ID를 포함해 재시도할 수 있게 한다.
  3. WebSocket 서버에 `/healthz` HTTP 핸들러와 “active sessions” 카운터를 추가해 런타임 헬스체크가 가능하도록 한다.
  4. 치명적 오류 vs 일시적 오류를 구분하는 에러 코드를 정의하고, 로그에 `severity` 필드를 포함해 외부 모니터링(CloudWatch, Datadog 등)으로 전송.
  5. (선택) OpenTelemetry 기반 분산 트레이싱을 적용해 Upstage/B edrock 호출 구간을 시각화한다.

---

### 4. 외부 서비스 호출 안정화
- **문제**: Upstage, Bedrock SDK 호출에 재시도·타임아웃·서킷 브레이커가 없어 네트워크 불안정 시 즉시 실패한다.
- **목표**: AWS SDK 재시도 설정 및 사용자 친화적 오류 메시지를 제공.
- **가이드라인**
  1. `aws-config.ts`에서 각 클라이언트 생성 시 `maxAttempts`, `retryStrategy`, `requestHandler` 타임아웃을 명시.
  2. Upstage API 호출에 대해 `AbortController` 기반 타임아웃(예: 120초)을 적용하고, 실패 시 워커가 자동 재시도하도록 래퍼 함수를 작성.
  3. Bedrock bidirectional 스트림은 `NodeHttp2Handler` 구성에 `sessionTimeout`/`requestTimeout`을 노출해 환경 변수로 조정 가능하게 한다.
  4. 사용자에게는 “서비스가 일시적으로 느립니다. 잠시 후 다시 시도하세요” 등 actionable 메시지를 반환하고, 내부 로그에는 원본 에러 스택을 남긴다.
  5. 외부 서비스별 rate limit을 환경 변수로 정의하고, 초과 시 큐 작업을 지연시키는 간단한 토큰 버킷 또는 sleep 전략을 적용한다.

---

### 5. 데이터 계층 최적화
- **문제**: DynamoDB 문서 목록이 `Scan` 기반이며 페이지네이션/필터가 없다.
- **목표**: 대량 문서 환경에서도 일관된 성능을 제공하고, 문서 상태별 조회를 지원.
- **가이드라인**
  1. 테이블 키 설계를 재검토(예: `PK = USER#<userId>`, `SK = DOC#<docId>`). 향후 Clerk 도입 시 사용자별 파티셔닝이 필요하다.
  2. 문서 상태(`status`) 또는 업로드 시각에 대한 GSI를 추가해 최신 문서/처리 중 문서를 빠르게 조회.
  3. `listDocuments` API를 페이지네이션(`LastEvaluatedKey`) 기반으로 수정하고, 클라이언트에 `nextToken`을 반환.
  4. 문서 세부정보 API에서 필요 없는 필드는 제외해 네트워크 비용을 줄인다.
  5. 인프라 IaC(예: CDK, Terraform) 문서에 새 인덱스와 용량 설정을 명시한다.

---

### 6. 클라이언트 오류 처리 및 UX 개선
- **문제**: 스트리밍 실패 시 클라이언트가 `"Streaming failed"` 같은 포괄적 메시지만 받는다.
- **목표**: 사용자가 재시도할지, 기다릴지 명확히 판단할 수 있도록 오류 프로토콜을 정의.
- **가이드라인**
  1. SSE/WS 프로토콜에 `type: 'error'` 객체 형태를 표준화하고, `category`(retryable/terminal)와 `hint` 필드를 포함.
  2. 프론트엔드 `useVoiceChat`/`useChat` 훅에서 오류 카테고리에 따라 자동 재연결, 사용자 알림, 로그 전송 등을 분기.
  3. 음성 세션 UI에 진행 단계(연결 중/응답 생성 중/도구 사용 중)를 노출하고, 오류 발생 시 해당 단계에 맞는 가이드를 보여준다.
  4. 문서 업로드 UI에는 상태 배지와 최근 실패 이유를 표시해 사용자가 재시도 버튼으로 즉시 파이프라인을 재개할 수 있게 한다.
  5. 사용성 테스트나 로그 기반으로 자주 발생하는 오류 메시지를 수집해 FAQ/도움말 섹션을 작성한다.

---

### 7. 테스트 및 시뮬레이션 환경
- **문제**: 현재 `test/` 폴더에는 샘플 스크립트뿐이며 핵심 경로에 대한 자동화 테스트가 없다.
- **목표**: 회귀 방지를 위한 최소 단위·통합·E2E 테스트 세트를 구축.
- **가이드라인**
  1. Bedrock/Upstage SDK를 모킹할 수 있는 유틸(`__mocks__/aws-sdk.ts`)을 작성해 단위 테스트에서 외부 호출을 차단.
  2. `NovaSession`/`NovaClient` 조합에 대한 시뮬레이션 테스트를 추가해 queue overflow, stop sequence 등을 검증.
  3. API 라우트별 통합 테스트를 `next-test-api-route-handler` 또는 `supertest` 기반으로 작성.
  4. 문서 업로드 전체 흐름은 E2E 테스트(Playwright 등)로 S3 presign → 상태 업데이트까지 검증. 실제 AWS 호출은 로컬스택/모킹으로 대체.
  5. GitHub Actions 등 CI 워크플로에 테스트 스위트를 통합해 PR마다 자동 실행하도록 구성.

---

### 8. 개발/운영 Docker 분리
- **문제**: 단일 프로덕션 Dockerfile만 존재해 로컬 개발에서 hot reload가 어렵고 이미지가 비대하다.
- **목표**: 개발용 Compose 환경을 별도로 구성해 빠른 피드백 루프를 확보하고, 운영 이미지를 슬림화.
- **가이드라인**
  1. `Dockerfile.dev`를 만들어 `node:20` 기반으로 `npm install`, `npm run dev`(또는 `tsx --watch server-voice.mjs`)를 실행하며 소스 디렉터리를 볼륨 마운트.
  2. `docker-compose.dev.yml`에서 환경 변수를 `.env.local`과 연동하고, Hot Reload 필요 파일만 볼륨 마운트한다.
  3. 운영 Dockerfile은 `npm ci` + `next build` 후 `node_modules`를 production dependencies만 유지하도록 `npm prune --omit=dev` 등을 적용해 크기 축소.
  4. README에 “개발 vs 운영” 실행 방법을 분리해 문서화하고, CI에서 운영 이미지를 빌드하여 레지스트리로 푸시하는 파이프라인을 구성.
  5. (선택) Compose Watch를 개발 구성에 붙여 특정 디렉터리만 `sync`하고, 서버 측 프로세스는 `nodemon`/`tsx --watch`로 재시작되도록 한다.

---

### 9. 중복 API 및 임시 스크립트 정리
- **문제**: 문서 상태 API가 `status`/`ingestion-status` 두 군데에서 중복 구현되어 있고, `parse-status` 디렉터리는 비어 있다. 또한 `test/test-pinecone.py`가 실제 API 키를 하드코딩한 채 저장되어 있어 보안·관리 측면에서 위험하다.
- **목표**: 사용되지 않는 디렉터리와 중복 코드를 제거하고, 민감 정보를 담은 테스트 스크립트를 템플릿으로 대체해 코드베이스를 정돈.
- **가이드라인**
  1. `app/api/documents/[docId]/status`와 `.../ingestion-status` 중 하나만 남기고, 공통 로직은 `lib/services/document-status.ts` 같은 모듈로 분리한다. Next App Router에서는 `{ params }: { params: { docId: string } }` 형태를 사용해 현재 `Promise`로 선언된 버그를 함께 수정한다.
  2. `app/api/documents/[docId]/parse-status` 빈 디렉터리를 삭제하거나 실제 구현을 채운다. 필요한 경우 README에 API 명세를 추가한다.
  3. `test/test-pinecone.py`와 `test/test-kb-query.ts`는 `PINECONE_API_KEY`, `KB_ID` 등 민감 값을 하드코딩하고 있다. 이 스크립트들은 `examples/` 디렉터리로 이동한 뒤 `.env.example`를 참조하도록 수정하거나, 완전히 제거하고 문서로 대체한다.
  4. 하드코딩된 자격 증명/리소스 ID가 포함된 커밋이 이미 리포지토리에 있다면, 키를 즉시 폐기·재발급하고 히스토리에서 제거하도록 보안 팀 절차를 따른다.
  5. 구조 정리가 끝나면 최상위 README의 프로젝트 구조 다이어그램도 최신 상태로 업데이트하여 실제 디렉터리 구성을 반영한다.

---

이 문서를 기반으로 각 개선 항목을 개별 작업으로 분할하고, 진행 상황을 프로젝트 이슈 트래커나 노션 등에 기록해 주세요. 추가 질문이 생기면 해당 섹션에 주석을 남기거나 이 문서를 업데이트하면 됩니다.

