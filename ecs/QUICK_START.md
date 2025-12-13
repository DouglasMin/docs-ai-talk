# 🚀 AI Doc Chat - ECS 배포 가이드 (전체 통합본)

> **이 파일 하나로 배포 완료!** 
> 실행 시간: 약 15분 | 필요: AWS CLI, Docker

## 📋 실제 환경 정보

```bash
AWS Account ID:    863518440691
Region:            us-east-1

# 이미 생성된 AWS 리소스 ✅
S3 Bucket:         kb-resouce-storage-dongik
DynamoDB Table:    ai-doc-chat-documents
Bedrock KB ID:     E5TKZO2C1Z
Data Source ID:    TGE67AEHGD
SQS Queue URL:     https://sqs.us-east-1.amazonaws.com/863518440691/ai-doc-chat-ingestion-queue

# 보안 패치 적용됨 ✅
Next.js:  16.0.3 → 16.0.7
React:    19.2.0 → 19.2.1
```

---

## ⚡ 3단계로 배포하기

### Step 1: 인프라 생성 (5분)

```bash
cd ecs

# 1. 인프라 자동 생성
./setup-infrastructure.sh

# 생성되는 리소스:
# ✅ ECR 리포지토리 2개 (webapp, worker)
# ✅ ECS Fargate 클러스터
# ✅ IAM 역할 2개
# ✅ Application Load Balancer
# ✅ Target Group + Health Check
# ✅ Security Groups
```

### Step 2: 환경 변수 설정 (2분)

**Option A: 자동 설정 스크립트 사용** (권장)

```bash
# SSM Parameter Store에 자동으로 설정
./setup-ssm-parameters.sh

# Upstage API Key만 수동 입력
aws ssm put-parameter \
  --name /ai-doc-chat/UPSTAGE_API_KEY \
  --value 'YOUR_UPSTAGE_API_KEY' \
  --type SecureString \
  --overwrite \
  --region us-east-1
```

**Option B: 수동 설정**

```bash
# 기본 설정 (이미 스크립트에 포함됨)
aws ssm put-parameter --name /ai-doc-chat/S3_BUCKET \
  --value "kb-resouce-storage-dongik" --type String --region us-east-1

aws ssm put-parameter --name /ai-doc-chat/DYNAMODB_TABLE_NAME \
  --value "ai-doc-chat-documents" --type String --region us-east-1

aws ssm put-parameter --name /ai-doc-chat/BEDROCK_KB_ID \
  --value "E5TKZO2C1Z" --type String --region us-east-1

aws ssm put-parameter --name /ai-doc-chat/BEDROCK_DATA_SOURCE_ID \
  --value "TGE67AEHGD" --type String --region us-east-1

aws ssm put-parameter --name /ai-doc-chat/SQS_INGESTION_QUEUE_URL \
  --value "https://sqs.us-east-1.amazonaws.com/863518440691/ai-doc-chat-ingestion-queue" \
  --type String --region us-east-1

# 민감 정보 (필수)
aws ssm put-parameter --name /ai-doc-chat/UPSTAGE_API_KEY \
  --value 'YOUR_UPSTAGE_API_KEY' --type SecureString --region us-east-1
```

**WebSocket URL 설정** (ALB 생성 후)

```bash
# Step 1에서 생성된 ALB DNS 사용
source deployment-config.sh

aws ssm put-parameter \
  --name /ai-doc-chat/NEXT_PUBLIC_WS_URL \
  --value "ws://$ALB_DNS" \
  --type String \
  --overwrite \
  --region us-east-1
```

### Step 3: 애플리케이션 배포 (10분)

```bash
# 1. 배포 설정 로드
source deployment-config.sh

# 2. 초기 서비스 생성 (최초 1회)
./create-ecs-services.sh

# 3. 배포 완료!
echo "Application URL: http://$ALB_DNS"
```

---

## ✅ 배포 확인

### 1. 서비스 상태 확인

```bash
aws ecs describe-services \
  --cluster ai-doc-chat-cluster \
  --services ai-doc-chat-webapp-service ai-doc-chat-worker-service \
  --region us-east-1 \
  --query 'services[*].[serviceName,runningCount,desiredCount]' \
  --output table
```

**예상 결과**:
```
---------------------------------------------------
|              DescribeServices                   |
+---------------------------------+----+----------+
|  ai-doc-chat-webapp-service     |  2 |    2    |
|  ai-doc-chat-worker-service     |  2 |    2    |
+---------------------------------+----+----------+
```

### 2. Health Check

```bash
# ALB DNS 확인
source deployment-config.sh
echo $ALB_DNS

# Health Check 엔드포인트 테스트
curl http://$ALB_DNS/api/health

# 예상 응답:
# {"status":"healthy","timestamp":"2025-12-09T...","service":"ai-doc-chat-webapp"}
```

### 3. 로그 확인

```bash
# Webapp 로그
aws logs tail /ecs/ai-doc-chat-webapp --follow --region us-east-1

# Worker 로그
aws logs tail /ecs/ai-doc-chat-worker --follow --region us-east-1
```

---

## 🔄 업데이트 배포

코드 변경 후 재배포:

```bash
cd ecs
source deployment-config.sh

# 자동으로 빌드 → ECR 푸시 → ECS 업데이트
./deploy.sh
```

---

## 🛠️ 자주 사용하는 명령어

### 서비스 스케일링

```bash
# Webapp 태스크 수 조정
aws ecs update-service \
  --cluster ai-doc-chat-cluster \
  --service ai-doc-chat-webapp-service \
  --desired-count 4 \
  --region us-east-1

# Worker 태스크 수 조정
aws ecs update-service \
  --cluster ai-doc-chat-cluster \
  --service ai-doc-chat-worker-service \
  --desired-count 3 \
  --region us-east-1
```

### 특정 Task 재시작

```bash
# Task ID 조회
aws ecs list-tasks \
  --cluster ai-doc-chat-cluster \
  --service-name ai-doc-chat-webapp-service \
  --region us-east-1

# Task 중지 (자동으로 새 Task 시작)
aws ecs stop-task \
  --cluster ai-doc-chat-cluster \
  --task TASK_ARN \
  --region us-east-1
```

### 파라미터 확인

```bash
# 모든 설정 확인
aws ssm get-parameters-by-path \
  --path /ai-doc-chat/ \
  --region us-east-1 \
  --output table

# 특정 파라미터 확인
aws ssm get-parameter \
  --name /ai-doc-chat/S3_BUCKET \
  --region us-east-1 \
  --query 'Parameter.Value' \
  --output text
```

---

## ⚠️ 트러블슈팅

### Task가 시작되지 않음

```bash
# 1. Task 실패 이유 확인
aws ecs describe-tasks \
  --cluster ai-doc-chat-cluster \
  --tasks $(aws ecs list-tasks --cluster ai-doc-chat-cluster --region us-east-1 --query 'taskArns[0]' --output text) \
  --region us-east-1 \
  --query 'tasks[0].stoppedReason'

# 2. CloudWatch Logs 확인
aws logs tail /ecs/ai-doc-chat-webapp --since 10m --region us-east-1

# 일반적인 원인:
# - ECR 이미지 pull 실패 → IAM 권한 확인
# - 환경 변수 로드 실패 → SSM Parameter 확인
# - 메모리 부족 → Task Definition에서 메모리 증가
```

### Health Check 실패

```bash
# Target Group Health 확인
aws elbv2 describe-target-health \
  --target-group-arn $(aws elbv2 describe-target-groups --region us-east-1 --query 'TargetGroups[?TargetGroupName==`ai-doc-chat-tg`].TargetGroupArn' --output text) \
  --region us-east-1

# Security Group 확인 - Port 3000 허용 확인
aws ec2 describe-security-groups \
  --filters "Name=group-name,Values=ai-doc-chat-ecs-sg" \
  --region us-east-1 \
  --query 'SecurityGroups[0].IpPermissions'
```

### Worker가 메시지를 처리하지 않음

```bash
# SQS 큐 상태 확인
aws sqs get-queue-attributes \
  --queue-url https://sqs.us-east-1.amazonaws.com/863518440691/ai-doc-chat-ingestion-queue \
  --attribute-names All \
  --region us-east-1

# Worker 로그 확인
aws logs tail /ecs/ai-doc-chat-worker --follow --region us-east-1

# 일반적인 원인:
# - IAM 권한 부족 (SQS ReceiveMessage, DeleteMessage)
# - SQS Queue URL 오류
# - Worker 코드 에러
```

---

## 💰 비용 예상

**현재 구성** (2 webapp + 2 worker tasks, 24/7):

| 리소스 | 사양 | 월 비용 |
|--------|------|---------|
| Fargate - Webapp | 1 vCPU, 2GB × 2 | $58.40 |
| Fargate Spot - Worker | 0.5 vCPU, 1GB × 2 | $8.76 |
| ALB | 1개 | $16.20 |
| CloudWatch Logs | 10GB | $5.00 |
| **총계** | - | **~$88/월** |

**비용 절감 팁**:

```bash
# 1. Worker를 Fargate Spot으로 전환 (70% 절감)
aws ecs update-service \
  --cluster ai-doc-chat-cluster \
  --service ai-doc-chat-worker-service \
  --capacity-provider-strategy capacityProvider=FARGATE_SPOT,weight=1 \
  --region us-east-1

# 2. CloudWatch Logs 보존 기간 설정 (30일)
aws logs put-retention-policy \
  --log-group-name /ecs/ai-doc-chat-webapp \
  --retention-in-days 30 \
  --region us-east-1

aws logs put-retention-policy \
  --log-group-name /ecs/ai-doc-chat-worker \
  --retention-in-days 30 \
  --region us-east-1
```

---

## 📚 더 자세한 정보

- **상세 가이드**: `README.md` 참조
- **전체 요약**: `/DEPLOYMENT.md` 참조
- **AWS 공식 문서**: https://docs.aws.amazon.com/ecs/

---

## 🎯 체크리스트

- [ ] AWS CLI 설정 완료 (`aws configure`)
- [ ] Docker 실행 중 (`docker ps`)
- [ ] `./setup-infrastructure.sh` 실행 완료
- [ ] `./setup-ssm-parameters.sh` 실행 완료
- [ ] Upstage API Key SSM에 저장 완료
- [ ] WebSocket URL SSM에 저장 완료
- [ ] `./create-ecs-services.sh` 실행 완료
- [ ] Health Check 통과 (`curl http://$ALB_DNS/api/health`)
- [ ] 웹 UI 접속 테스트 완료
- [ ] 문서 업로드 테스트 완료
- [ ] Worker 로그 확인 완료

**모든 체크 완료하면 배포 성공! 🎉**

