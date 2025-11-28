# AI Document Chat (개발 중 🚧)

AWS Bedrock의 Nova Sonic을 활용한 실시간 음성 기반 문서 질의응답 애플리케이션

## 📋 프로젝트 개요

이 프로젝트는 AWS Bedrock의 Nova Sonic 모델을 사용하여 음성으로 문서를 검색하고 질문할 수 있는 Full-stack Next.js 애플리케이션입니다.

### 주요 기능 (개발 중)

- 🎤 **실시간 음성 채팅**: Nova Sonic의 양방향 스트리밍을 통한 음성 대화
- 📄 **문서 업로드 및 관리**: PDF, DOCX 등 다양한 형식 지원 예정
- 🔍 **지식 기반 검색**: AWS Bedrock Knowledge Base를 활용한 문서 검색
- 🔧 **Tool Use**: 문서 검색을 위한 함수 호출 기능
- 💬 **텍스트 채팅**: 음성과 텍스트 동시 지원 예정

## 🏗️ 기술 스택

### Frontend
- **Next.js 14** - React 프레임워크
- **TypeScript** - 타입 안정성
- **Tailwind CSS** - 스타일링
- **Web Audio API** - 실시간 오디오 처리
- **AudioWorklet** - 고성능 오디오 프로세싱

### Backend
- **Node.js** - 서버 런타임
- **WebSocket (ws)** - 실시간 양방향 통신
- **AWS SDK v3** - Bedrock 통합
- **HTTP/2** - 양방향 스트리밍 지원

### AWS Services
- **Amazon Bedrock** - AI 모델 추론
- **Nova Sonic v1** - 음성-텍스트 통합 모델
- **Bedrock Knowledge Base** - 문서 저장 및 검색
- **S3** - 문서 저장

## 📁 프로젝트 구조

```
my-ai-app/
├── ai-doc-chat/                    # 메인 애플리케이션
│   ├── app/                        # Next.js App Router
│   ├── components/                 # React 컴포넌트
│   │   ├── ChatArea.tsx           # 채팅 인터페이스
│   │   ├── DocumentSidebar.tsx    # 문서 관리
│   │   └── EmptyState.tsx         # 초기 화면
│   ├── lib/
│   │   ├── voice/                 # 음성 처리 로직
│   │   │   ├── client.ts         # Bedrock 클라이언트
│   │   │   ├── server.ts         # WebSocket 서버
│   │   │   ├── session.ts        # 세션 관리
│   │   │   └── config.ts         # 설정
│   │   ├── hooks/
│   │   │   └── useVoiceChat.ts   # 음성 채팅 훅
│   │   └── services/
│   │       └── bedrock-service.ts # Bedrock 서비스
│   ├── public/
│   │   └── audio-processor.js     # AudioWorklet 프로세서
│   ├── server-voice.mjs           # 커스텀 WebSocket 서버
│   └── package.json
│
├── aws-bedrock-example/           # 참고 예제
│   └── nova-sonic-example/        # 작동하는 참고 코드
│
└── .gitignore
```

## 🚀 시작하기

### 필수 요구사항

- Node.js 18+ 
- npm 또는 yarn
- AWS 계정 및 Bedrock 액세스 권한

### 환경 변수 설정

`ai-doc-chat/.env.local` 파일을 생성하고 다음 변수를 설정하세요:

```env
# AWS Credentials
AWS_ACCESS_KEY_ID=your_access_key
AWS_SECRET_ACCESS_KEY=your_secret_key
AWS_REGION=us-east-1

# Bedrock Knowledge Base
BEDROCK_KB_ID=your_knowledge_base_id
```

### 설치 및 실행

```bash
# 의존성 설치
cd ai-doc-chat
npm install

# 개발 서버 실행
npm run dev
```

서버가 시작되면:
- **웹 애플리케이션**: http://localhost:3000
- **WebSocket**: ws://localhost:3000/api/voice-ws

## 🔧 현재 개발 상태

### ✅ 완료된 기능
- [x] 기본 Next.js 프로젝트 구조
- [x] WebSocket 서버 설정
- [x] Nova Sonic 양방향 스트리밍 연동
- [x] 오디오 입력 처리 (마이크 → PCM 16-bit 16kHz)
- [x] 오디오 출력 처리 (PCM 16-bit 24kHz → 재생)
- [x] Tool Use 구현 (문서 검색)
- [x] 세션 관리 및 이벤트 스트리밍
- [x] UI 컴포넌트 기본 구조

### 🚧 개발 중
- [ ] 오디오 품질 최적화 (노이즈 제거)
- [ ] 문서 업로드 기능
- [ ] 텍스트 채팅 인터페이스 개선
- [ ] 에러 핸들링 강화
- [ ] 세션 종료 로직 안정화

### 📝 예정
- [ ] 사용자 인증
- [ ] 채팅 히스토리 저장
- [ ] 다중 문서 관리
- [ ] 음성 설정 커스터마이징
- [ ] 반응형 디자인 개선

## 🎯 주요 이슈 및 해결 과정

### 1. 양방향 스트리밍 구현
- **문제**: Nova Sonic의 `InvokeModelWithBidirectionalStreamCommand` 사용 시 입력 스트림이 제대로 전송되지 않음
- **해결**: Async Generator를 직접 `body`에 전달하고, `bedrockClient.send()`를 `await` 없이 호출하여 generator가 먼저 실행되도록 수정

### 2. 오디오 처리
- **문제**: 출력 오디오에 노이즈 발생
- **상태**: 진행 중 - AudioWorklet 버퍼링 및 변환 로직 최적화 중

### 3. 세션 종료
- **문제**: "Cannot end content as no content data was received" 에러
- **해결**: 종료 이벤트 순서 조정 및 큐 처리 로직 개선

## 📚 참고 자료

- [AWS Nova Sonic 공식 문서](https://docs.aws.amazon.com/nova/latest/userguide/speech-bidirection.html)
- [AWS Bedrock 양방향 스트리밍](https://docs.aws.amazon.com/bedrock/latest/userguide/bedrock-runtime_example_bedrock-runtime_InvokeModelWithBidirectionalStream_section.html)
- [Web Audio API](https://developer.mozilla.org/en-US/docs/Web/API/Web_Audio_API)

## 🤝 기여

현재 개발 중인 프로젝트입니다. 이슈 및 개선 제안은 언제든 환영합니다!

## 📄 라이센스

MIT License

---

**개발 진행 중** - 일부 기능이 완전하지 않을 수 있습니다.


