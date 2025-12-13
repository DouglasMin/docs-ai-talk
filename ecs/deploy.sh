#!/bin/bash

# AI Doc Chat - AWS ECS Deployment Script
# This script automates the deployment of the Next.js webapp and worker to AWS ECS

set -e  # Exit on error

# Colors for output
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
NC='\033[0m' # No Color

# Configuration
AWS_REGION="${AWS_REGION:-us-east-1}"
AWS_ACCOUNT_ID="${AWS_ACCOUNT_ID:-863518440691}"
ECR_WEBAPP_REPO="ai-doc-chat-webapp"
ECR_WORKER_REPO="ai-doc-chat-worker"
ECS_CLUSTER="ai-doc-chat-cluster"
WEBAPP_SERVICE="ai-doc-chat-webapp-service"
WORKER_SERVICE="ai-doc-chat-worker-service"

# Check required environment variables
if [ -z "$AWS_ACCOUNT_ID" ]; then
  echo -e "${RED}Error: AWS_ACCOUNT_ID environment variable is required${NC}"
  echo "Usage: AWS_ACCOUNT_ID=123456789012 ./deploy.sh"
  exit 1
fi

echo -e "${GREEN}========================================${NC}"
echo -e "${GREEN}AI Doc Chat - ECS Deployment${NC}"
echo -e "${GREEN}========================================${NC}"
echo ""
echo "AWS Account ID: $AWS_ACCOUNT_ID"
echo "AWS Region: $AWS_REGION"
echo "ECS Cluster: $ECS_CLUSTER"
echo ""

# Step 1: Login to ECR
echo -e "${YELLOW}Step 1: Logging into Amazon ECR...${NC}"
aws ecr get-login-password --region $AWS_REGION | \
  docker login --username AWS --password-stdin $AWS_ACCOUNT_ID.dkr.ecr.$AWS_REGION.amazonaws.com
echo -e "${GREEN}✓ Logged into ECR${NC}"
echo ""

# Step 2: Build and push webapp image
echo -e "${YELLOW}Step 2: Building and pushing webapp Docker image...${NC}"
cd ../ai-doc-chat

# Build webapp
docker build -t $ECR_WEBAPP_REPO:latest -f Dockerfile .
docker tag $ECR_WEBAPP_REPO:latest $AWS_ACCOUNT_ID.dkr.ecr.$AWS_REGION.amazonaws.com/$ECR_WEBAPP_REPO:latest
docker tag $ECR_WEBAPP_REPO:latest $AWS_ACCOUNT_ID.dkr.ecr.$AWS_REGION.amazonaws.com/$ECR_WEBAPP_REPO:$(git rev-parse --short HEAD)

# Push webapp
docker push $AWS_ACCOUNT_ID.dkr.ecr.$AWS_REGION.amazonaws.com/$ECR_WEBAPP_REPO:latest
docker push $AWS_ACCOUNT_ID.dkr.ecr.$AWS_REGION.amazonaws.com/$ECR_WEBAPP_REPO:$(git rev-parse --short HEAD)

echo -e "${GREEN}✓ Webapp image pushed to ECR${NC}"
echo ""

# Step 3: Build and push worker image
echo -e "${YELLOW}Step 3: Building and pushing worker Docker image...${NC}"

# Build worker
docker build -t $ECR_WORKER_REPO:latest -f Dockerfile.worker .
docker tag $ECR_WORKER_REPO:latest $AWS_ACCOUNT_ID.dkr.ecr.$AWS_REGION.amazonaws.com/$ECR_WORKER_REPO:latest
docker tag $ECR_WORKER_REPO:latest $AWS_ACCOUNT_ID.dkr.ecr.$AWS_REGION.amazonaws.com/$ECR_WORKER_REPO:$(git rev-parse --short HEAD)

# Push worker
docker push $AWS_ACCOUNT_ID.dkr.ecr.$AWS_REGION.amazonaws.com/$ECR_WORKER_REPO:latest
docker push $AWS_ACCOUNT_ID.dkr.ecr.$AWS_REGION.amazonaws.com/$ECR_WORKER_REPO:$(git rev-parse --short HEAD)

echo -e "${GREEN}✓ Worker image pushed to ECR${NC}"
echo ""

cd ../ecs

# Step 4: Update task definitions
echo -e "${YELLOW}Step 4: Registering ECS task definitions...${NC}"

# Replace placeholders in task definitions
sed -e "s/YOUR_ACCOUNT_ID/$AWS_ACCOUNT_ID/g" \
    -e "s/YOUR_REGION/$AWS_REGION/g" \
    task-definition-webapp.json > task-definition-webapp-updated.json

sed -e "s/YOUR_ACCOUNT_ID/$AWS_ACCOUNT_ID/g" \
    -e "s/YOUR_REGION/$AWS_REGION/g" \
    task-definition-worker.json > task-definition-worker-updated.json

# Register task definitions
WEBAPP_TASK_DEF_ARN=$(aws ecs register-task-definition \
  --cli-input-json file://task-definition-webapp-updated.json \
  --region $AWS_REGION \
  --query 'taskDefinition.taskDefinitionArn' \
  --output text)

WORKER_TASK_DEF_ARN=$(aws ecs register-task-definition \
  --cli-input-json file://task-definition-worker-updated.json \
  --region $AWS_REGION \
  --query 'taskDefinition.taskDefinitionArn' \
  --output text)

echo -e "${GREEN}✓ Task definitions registered${NC}"
echo "  Webapp: $WEBAPP_TASK_DEF_ARN"
echo "  Worker: $WORKER_TASK_DEF_ARN"
echo ""

# Step 5: Update ECS services
echo -e "${YELLOW}Step 5: Updating ECS services...${NC}"

# Update webapp service
aws ecs update-service \
  --cluster $ECS_CLUSTER \
  --service $WEBAPP_SERVICE \
  --task-definition $WEBAPP_TASK_DEF_ARN \
  --force-new-deployment \
  --region $AWS_REGION \
  > /dev/null

echo -e "${GREEN}✓ Webapp service updated${NC}"

# Update worker service
aws ecs update-service \
  --cluster $ECS_CLUSTER \
  --service $WORKER_SERVICE \
  --task-definition $WORKER_TASK_DEF_ARN \
  --force-new-deployment \
  --region $AWS_REGION \
  > /dev/null

echo -e "${GREEN}✓ Worker service updated${NC}"
echo ""

# Cleanup
rm task-definition-webapp-updated.json task-definition-worker-updated.json

# Step 6: Wait for deployment
echo -e "${YELLOW}Step 6: Waiting for services to stabilize...${NC}"
echo "This may take a few minutes..."
echo ""

aws ecs wait services-stable \
  --cluster $ECS_CLUSTER \
  --services $WEBAPP_SERVICE $WORKER_SERVICE \
  --region $AWS_REGION

echo -e "${GREEN}========================================${NC}"
echo -e "${GREEN}Deployment completed successfully!${NC}"
echo -e "${GREEN}========================================${NC}"
echo ""
echo "Next steps:"
echo "1. Check service status: aws ecs describe-services --cluster $ECS_CLUSTER --services $WEBAPP_SERVICE $WORKER_SERVICE"
echo "2. View logs: aws logs tail /ecs/ai-doc-chat-webapp --follow"
echo "3. Access your application via the ALB DNS name"

