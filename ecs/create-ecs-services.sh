#!/bin/bash

# Create ECS Services (run once after infrastructure setup and first deployment)

set -e

GREEN='\033[0;32m'
YELLOW='\033[1;33m'
RED='\033[0;31m'
NC='\033[0m'

# Load configuration
if [ ! -f "deployment-config.sh" ]; then
  echo -e "${RED}Error: deployment-config.sh not found${NC}"
  echo "Please run setup-infrastructure.sh first"
  exit 1
fi

source deployment-config.sh

echo -e "${GREEN}========================================${NC}"
echo -e "${GREEN}Creating ECS Services${NC}"
echo -e "${GREEN}========================================${NC}"
echo ""

# Create Webapp Service
echo -e "${YELLOW}Creating webapp service...${NC}"

aws ecs create-service \
  --cluster $ECS_CLUSTER \
  --service-name ai-doc-chat-webapp-service \
  --task-definition ai-doc-chat-webapp \
  --desired-count 2 \
  --launch-type FARGATE \
  --platform-version LATEST \
  --network-configuration "awsvpcConfiguration={subnets=[$SUBNETS],securityGroups=[$ECS_SG_ID],assignPublicIp=ENABLED}" \
  --load-balancers "targetGroupArn=$TG_ARN,containerName=ai-doc-chat-webapp,containerPort=3000" \
  --health-check-grace-period-seconds 60 \
  --deployment-configuration "maximumPercent=200,minimumHealthyPercent=100,deploymentCircuitBreaker={enable=true,rollback=true}" \
  --region $AWS_REGION \
  > /dev/null

echo -e "${GREEN}✓ Webapp service created${NC}"

# Create Worker Service
echo -e "${YELLOW}Creating worker service...${NC}"

aws ecs create-service \
  --cluster $ECS_CLUSTER \
  --service-name ai-doc-chat-worker-service \
  --task-definition ai-doc-chat-worker \
  --desired-count 2 \
  --launch-type FARGATE \
  --platform-version LATEST \
  --network-configuration "awsvpcConfiguration={subnets=[$SUBNETS],securityGroups=[$ECS_SG_ID],assignPublicIp=ENABLED}" \
  --deployment-configuration "maximumPercent=200,minimumHealthyPercent=50,deploymentCircuitBreaker={enable=true,rollback=true}" \
  --region $AWS_REGION \
  > /dev/null

echo -e "${GREEN}✓ Worker service created${NC}"
echo ""

echo -e "${GREEN}========================================${NC}"
echo -e "${GREEN}Services Created Successfully!${NC}"
echo -e "${GREEN}========================================${NC}"
echo ""
echo "Services:"
echo "  - ai-doc-chat-webapp-service (2 tasks)"
echo "  - ai-doc-chat-worker-service (2 tasks)"
echo ""
echo "Next steps:"
echo "  1. Wait for services to become stable (may take a few minutes)"
echo "  2. Check service status:"
echo "     aws ecs describe-services --cluster $ECS_CLUSTER --services ai-doc-chat-webapp-service ai-doc-chat-worker-service"
echo ""
echo "  3. Access application:"
echo "     http://$ALB_DNS"

