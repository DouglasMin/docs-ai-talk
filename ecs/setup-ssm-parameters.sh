#!/bin/bash

# AI Doc Chat - SSM Parameter Store 설정 스크립트
# 실제 환경 변수 값을 AWS Systems Manager Parameter Store에 저장

set -e

GREEN='\033[0;32m'
YELLOW='\033[1;33m'
RED='\033[0;31m'
NC='\033[0m'

AWS_REGION="us-east-1"
AWS_ACCOUNT_ID="863518440691"

echo -e "${GREEN}========================================${NC}"
echo -e "${GREEN}Setting up SSM Parameters${NC}"
echo -e "${GREEN}========================================${NC}"
echo ""
echo "Region: $AWS_REGION"
echo "Account: $AWS_ACCOUNT_ID"
echo ""

# 함수: Parameter 생성/업데이트
put_parameter() {
  local name=$1
  local value=$2
  local type=${3:-String}
  
  echo -e "${YELLOW}Setting: $name${NC}"
  
  aws ssm put-parameter \
    --name "$name" \
    --value "$value" \
    --type "$type" \
    --overwrite \
    --region $AWS_REGION \
    > /dev/null 2>&1
  
  echo -e "${GREEN}✓ Set: $name${NC}"
}

# S3 Bucket
put_parameter "/ai-doc-chat/S3_BUCKET" "kb-resouce-storage-dongik"

# DynamoDB Table
put_parameter "/ai-doc-chat/DYNAMODB_TABLE_NAME" "ai-doc-chat-documents"

# Bedrock Knowledge Base
put_parameter "/ai-doc-chat/BEDROCK_KB_ID" "E5TKZO2C1Z"
put_parameter "/ai-doc-chat/BEDROCK_DATA_SOURCE_ID" "TGE67AEHGD"

# SQS Queue URL
put_parameter "/ai-doc-chat/SQS_INGESTION_QUEUE_URL" \
  "https://sqs.us-east-1.amazonaws.com/863518440691/ai-doc-chat-ingestion-queue"

# Upstage Timeout (optional)
put_parameter "/ai-doc-chat/UPSTAGE_TIMEOUT_MS" "180000"

echo ""
echo -e "${YELLOW}========================================${NC}"
echo -e "${YELLOW}Secrets (민감 정보는 수동 입력 필요)${NC}"
echo -e "${YELLOW}========================================${NC}"
echo ""
echo "다음 명령어로 민감 정보를 직접 입력하세요:"
echo ""
echo -e "${GREEN}# Upstage API Key${NC}"
echo "aws ssm put-parameter \\"
echo "  --name /ai-doc-chat/UPSTAGE_API_KEY \\"
echo "  --value 'YOUR_UPSTAGE_API_KEY' \\"
echo "  --type SecureString \\"
echo "  --overwrite \\"
echo "  --region us-east-1"
echo ""
echo -e "${GREEN}# WebSocket URL (ALB 생성 후)${NC}"
echo "source deployment-config.sh"
echo "aws ssm put-parameter \\"
echo "  --name /ai-doc-chat/NEXT_PUBLIC_WS_URL \\"
echo "  --value \"ws://\$ALB_DNS\" \\"
echo "  --type String \\"
echo "  --overwrite \\"
echo "  --region us-east-1"
echo ""

# 현재 .env 파일에서 Upstage API Key를 자동으로 가져오기 (선택사항)
if [ -f "../ai-doc-chat/.env" ]; then
  echo -e "${YELLOW}========================================${NC}"
  echo -e "${YELLOW}.env 파일에서 자동 설정 (선택)${NC}"
  echo -e "${YELLOW}========================================${NC}"
  echo ""
  
  UPSTAGE_KEY=$(grep UPSTAGE_API_KEY ../ai-doc-chat/.env | cut -d '=' -f2)
  
  if [ -n "$UPSTAGE_KEY" ]; then
    read -p "Upstage API Key를 자동으로 설정하시겠습니까? (y/N): " -n 1 -r
    echo
    if [[ $REPLY =~ ^[Yy]$ ]]; then
      put_parameter "/ai-doc-chat/UPSTAGE_API_KEY" "$UPSTAGE_KEY" "SecureString"
    fi
  fi
fi

echo ""
echo -e "${GREEN}========================================${NC}"
echo -e "${GREEN}SSM Parameters 설정 완료!${NC}"
echo -e "${GREEN}========================================${NC}"
echo ""
echo "설정된 파라미터 확인:"
echo "aws ssm get-parameters-by-path --path /ai-doc-chat/ --region us-east-1"

