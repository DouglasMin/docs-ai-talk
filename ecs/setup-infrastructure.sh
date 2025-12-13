#!/bin/bash

# AI Doc Chat - AWS Infrastructure Setup Script
# This script creates all required AWS resources for the ECS deployment

set -e

# Colors for output
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
BLUE='\033[0;34m'
NC='\033[0m'

# Configuration
AWS_REGION="${AWS_REGION:-us-east-1}"
AWS_ACCOUNT_ID="${AWS_ACCOUNT_ID:-863518440691}"
PROJECT_NAME="ai-doc-chat"

# Check required environment variables
if [ -z "$AWS_ACCOUNT_ID" ]; then
  echo -e "${RED}Error: AWS_ACCOUNT_ID environment variable is required${NC}"
  echo "Usage: AWS_ACCOUNT_ID=863518440691 ./setup-infrastructure.sh"
  exit 1
fi

echo -e "${GREEN}========================================${NC}"
echo -e "${GREEN}AI Doc Chat - Infrastructure Setup${NC}"
echo -e "${GREEN}========================================${NC}"
echo ""
echo "AWS Account ID: $AWS_ACCOUNT_ID"
echo "AWS Region: $AWS_REGION"
echo ""

# Function to check if resource exists
resource_exists() {
  local check_command=$1
  eval $check_command > /dev/null 2>&1
  return $?
}

# Step 1: Create ECR repositories
echo -e "${YELLOW}Step 1: Creating ECR repositories...${NC}"

for repo in "${PROJECT_NAME}-webapp" "${PROJECT_NAME}-worker"; do
  if resource_exists "aws ecr describe-repositories --repository-names $repo --region $AWS_REGION"; then
    echo -e "${BLUE}  ECR repository $repo already exists${NC}"
  else
    aws ecr create-repository \
      --repository-name $repo \
      --region $AWS_REGION \
      --image-scanning-configuration scanOnPush=true \
      --encryption-configuration encryptionType=AES256 > /dev/null
    echo -e "${GREEN}  ✓ Created ECR repository: $repo${NC}"
  fi
done
echo ""

# Step 2: Create IAM roles
echo -e "${YELLOW}Step 2: Creating IAM roles...${NC}"

# Task execution role (for pulling images and secrets)
EXECUTION_ROLE_NAME="ecsTaskExecutionRole"
if resource_exists "aws iam get-role --role-name $EXECUTION_ROLE_NAME"; then
  echo -e "${BLUE}  IAM role $EXECUTION_ROLE_NAME already exists${NC}"
else
  aws iam create-role \
    --role-name $EXECUTION_ROLE_NAME \
    --assume-role-policy-document file://iam-trust-policy.json > /dev/null
  
  aws iam attach-role-policy \
    --role-name $EXECUTION_ROLE_NAME \
    --policy-arn arn:aws:iam::aws:policy/service-role/AmazonECSTaskExecutionRolePolicy
  
  echo -e "${GREEN}  ✓ Created IAM role: $EXECUTION_ROLE_NAME${NC}"
fi

# Task role (for application permissions)
TASK_ROLE_NAME="${PROJECT_NAME}-task-role"
if resource_exists "aws iam get-role --role-name $TASK_ROLE_NAME"; then
  echo -e "${BLUE}  IAM role $TASK_ROLE_NAME already exists${NC}"
else
  aws iam create-role \
    --role-name $TASK_ROLE_NAME \
    --assume-role-policy-document file://iam-trust-policy.json > /dev/null
  
  # Create and attach custom policy
  POLICY_ARN=$(aws iam create-policy \
    --policy-name "${PROJECT_NAME}-task-policy" \
    --policy-document file://iam-policy-task-role.json \
    --query 'Policy.Arn' \
    --output text 2>/dev/null || echo "arn:aws:iam::$AWS_ACCOUNT_ID:policy/${PROJECT_NAME}-task-policy")
  
  aws iam attach-role-policy \
    --role-name $TASK_ROLE_NAME \
    --policy-arn $POLICY_ARN || true
  
  echo -e "${GREEN}  ✓ Created IAM role: $TASK_ROLE_NAME${NC}"
fi
echo ""

# Step 3: Create ECS Cluster
echo -e "${YELLOW}Step 3: Creating ECS cluster...${NC}"

CLUSTER_NAME="${PROJECT_NAME}-cluster"
if resource_exists "aws ecs describe-clusters --clusters $CLUSTER_NAME --region $AWS_REGION | grep -q ACTIVE"; then
  echo -e "${BLUE}  ECS cluster $CLUSTER_NAME already exists${NC}"
else
  aws ecs create-cluster \
    --cluster-name $CLUSTER_NAME \
    --region $AWS_REGION \
    --capacity-providers FARGATE FARGATE_SPOT \
    --default-capacity-provider-strategy capacityProvider=FARGATE,weight=1 > /dev/null
  echo -e "${GREEN}  ✓ Created ECS cluster: $CLUSTER_NAME${NC}"
fi
echo ""

# Step 4: Create VPC resources (if needed)
echo -e "${YELLOW}Step 4: Checking VPC configuration...${NC}"

# Get default VPC
DEFAULT_VPC=$(aws ec2 describe-vpcs \
  --filters "Name=isDefault,Values=true" \
  --region $AWS_REGION \
  --query 'Vpcs[0].VpcId' \
  --output text)

if [ "$DEFAULT_VPC" != "None" ] && [ -n "$DEFAULT_VPC" ]; then
  echo -e "${GREEN}  ✓ Using default VPC: $DEFAULT_VPC${NC}"
  
  # Get subnets
  SUBNETS=$(aws ec2 describe-subnets \
    --filters "Name=vpc-id,Values=$DEFAULT_VPC" \
    --region $AWS_REGION \
    --query 'Subnets[*].SubnetId' \
    --output text | tr '\t' ',')
  
  echo -e "${GREEN}  ✓ Using subnets: $SUBNETS${NC}"
else
  echo -e "${RED}  No default VPC found. Please create a VPC manually.${NC}"
  exit 1
fi
echo ""

# Step 5: Create Security Groups
echo -e "${YELLOW}Step 5: Creating security groups...${NC}"

# ALB Security Group
ALB_SG_NAME="${PROJECT_NAME}-alb-sg"
ALB_SG_ID=$(aws ec2 describe-security-groups \
  --filters "Name=group-name,Values=$ALB_SG_NAME" "Name=vpc-id,Values=$DEFAULT_VPC" \
  --region $AWS_REGION \
  --query 'SecurityGroups[0].GroupId' \
  --output text 2>/dev/null || echo "None")

if [ "$ALB_SG_ID" != "None" ] && [ -n "$ALB_SG_ID" ]; then
  echo -e "${BLUE}  Security group $ALB_SG_NAME already exists: $ALB_SG_ID${NC}"
else
  ALB_SG_ID=$(aws ec2 create-security-group \
    --group-name $ALB_SG_NAME \
    --description "Security group for AI Doc Chat ALB" \
    --vpc-id $DEFAULT_VPC \
    --region $AWS_REGION \
    --query 'GroupId' \
    --output text)
  
  # Allow HTTP and HTTPS from internet
  aws ec2 authorize-security-group-ingress \
    --group-id $ALB_SG_ID \
    --protocol tcp \
    --port 80 \
    --cidr 0.0.0.0/0 \
    --region $AWS_REGION > /dev/null
  
  aws ec2 authorize-security-group-ingress \
    --group-id $ALB_SG_ID \
    --protocol tcp \
    --port 443 \
    --cidr 0.0.0.0/0 \
    --region $AWS_REGION > /dev/null
  
  echo -e "${GREEN}  ✓ Created security group: $ALB_SG_NAME ($ALB_SG_ID)${NC}"
fi

# ECS Tasks Security Group
ECS_SG_NAME="${PROJECT_NAME}-ecs-sg"
ECS_SG_ID=$(aws ec2 describe-security-groups \
  --filters "Name=group-name,Values=$ECS_SG_NAME" "Name=vpc-id,Values=$DEFAULT_VPC" \
  --region $AWS_REGION \
  --query 'SecurityGroups[0].GroupId' \
  --output text 2>/dev/null || echo "None")

if [ "$ECS_SG_ID" != "None" ] && [ -n "$ECS_SG_ID" ]; then
  echo -e "${BLUE}  Security group $ECS_SG_NAME already exists: $ECS_SG_ID${NC}"
else
  ECS_SG_ID=$(aws ec2 create-security-group \
    --group-name $ECS_SG_NAME \
    --description "Security group for AI Doc Chat ECS tasks" \
    --vpc-id $DEFAULT_VPC \
    --region $AWS_REGION \
    --query 'GroupId' \
    --output text)
  
  # Allow traffic from ALB
  aws ec2 authorize-security-group-ingress \
    --group-id $ECS_SG_ID \
    --protocol tcp \
    --port 3000 \
    --source-group $ALB_SG_ID \
    --region $AWS_REGION > /dev/null
  
  # Allow all outbound traffic (default)
  
  echo -e "${GREEN}  ✓ Created security group: $ECS_SG_NAME ($ECS_SG_ID)${NC}"
fi
echo ""

# Step 6: Create Application Load Balancer
echo -e "${YELLOW}Step 6: Creating Application Load Balancer...${NC}"

ALB_NAME="${PROJECT_NAME}-alb"
ALB_ARN=$(aws elbv2 describe-load-balancers \
  --names $ALB_NAME \
  --region $AWS_REGION \
  --query 'LoadBalancers[0].LoadBalancerArn' \
  --output text 2>/dev/null || echo "None")

if [ "$ALB_ARN" != "None" ] && [ -n "$ALB_ARN" ]; then
  echo -e "${BLUE}  ALB $ALB_NAME already exists${NC}"
else
  ALB_ARN=$(aws elbv2 create-load-balancer \
    --name $ALB_NAME \
    --subnets $(echo $SUBNETS | tr ',' ' ') \
    --security-groups $ALB_SG_ID \
    --scheme internet-facing \
    --type application \
    --ip-address-type ipv4 \
    --region $AWS_REGION \
    --query 'LoadBalancers[0].LoadBalancerArn' \
    --output text)
  
  echo -e "${GREEN}  ✓ Created ALB: $ALB_NAME${NC}"
fi

# Get ALB DNS
ALB_DNS=$(aws elbv2 describe-load-balancers \
  --load-balancer-arns $ALB_ARN \
  --region $AWS_REGION \
  --query 'LoadBalancers[0].DNSName' \
  --output text)

echo -e "${GREEN}  ALB DNS: $ALB_DNS${NC}"
echo ""

# Step 7: Create Target Group
echo -e "${YELLOW}Step 7: Creating target group...${NC}"

TG_NAME="${PROJECT_NAME}-tg"
TG_ARN=$(aws elbv2 describe-target-groups \
  --names $TG_NAME \
  --region $AWS_REGION \
  --query 'TargetGroups[0].TargetGroupArn' \
  --output text 2>/dev/null || echo "None")

if [ "$TG_ARN" != "None" ] && [ -n "$TG_ARN" ]; then
  echo -e "${BLUE}  Target group $TG_NAME already exists${NC}"
else
  TG_ARN=$(aws elbv2 create-target-group \
    --name $TG_NAME \
    --protocol HTTP \
    --port 3000 \
    --vpc-id $DEFAULT_VPC \
    --target-type ip \
    --health-check-enabled \
    --health-check-protocol HTTP \
    --health-check-path /api/health \
    --health-check-interval-seconds 30 \
    --health-check-timeout-seconds 5 \
    --healthy-threshold-count 2 \
    --unhealthy-threshold-count 3 \
    --region $AWS_REGION \
    --query 'TargetGroups[0].TargetGroupArn' \
    --output text)
  
  echo -e "${GREEN}  ✓ Created target group: $TG_NAME${NC}"
fi
echo ""

# Step 8: Create ALB Listener
echo -e "${YELLOW}Step 8: Creating ALB listener...${NC}"

LISTENER_ARN=$(aws elbv2 describe-listeners \
  --load-balancer-arn $ALB_ARN \
  --region $AWS_REGION \
  --query 'Listeners[0].ListenerArn' \
  --output text 2>/dev/null || echo "None")

if [ "$LISTENER_ARN" != "None" ] && [ -n "$LISTENER_ARN" ]; then
  echo -e "${BLUE}  ALB listener already exists${NC}"
else
  LISTENER_ARN=$(aws elbv2 create-listener \
    --load-balancer-arn $ALB_ARN \
    --protocol HTTP \
    --port 80 \
    --default-actions Type=forward,TargetGroupArn=$TG_ARN \
    --region $AWS_REGION \
    --query 'Listeners[0].ListenerArn' \
    --output text)
  
  echo -e "${GREEN}  ✓ Created ALB listener${NC}"
fi
echo ""

# Step 9: Create ECS Services
echo -e "${YELLOW}Step 9: Creating ECS services (placeholders)...${NC}"
echo -e "${BLUE}  Note: Run deploy.sh to create actual services after pushing images${NC}"
echo ""

# Step 10: Store configuration in SSM Parameter Store
echo -e "${YELLOW}Step 10: Storing configuration...${NC}"

cat > deployment-config.sh << EOF
# AI Doc Chat Deployment Configuration
export AWS_REGION="$AWS_REGION"
export AWS_ACCOUNT_ID="$AWS_ACCOUNT_ID"
export ECS_CLUSTER="${PROJECT_NAME}-cluster"
export ALB_DNS="$ALB_DNS"
export ALB_ARN="$ALB_ARN"
export TG_ARN="$TG_ARN"
export ECS_SG_ID="$ECS_SG_ID"
export SUBNETS="$SUBNETS"
EOF

echo -e "${GREEN}  ✓ Configuration saved to deployment-config.sh${NC}"
echo ""

# Summary
echo -e "${GREEN}========================================${NC}"
echo -e "${GREEN}Infrastructure Setup Complete!${NC}"
echo -e "${GREEN}========================================${NC}"
echo ""
echo "Created resources:"
echo "  - ECR Repositories: ${PROJECT_NAME}-webapp, ${PROJECT_NAME}-worker"
echo "  - ECS Cluster: ${PROJECT_NAME}-cluster"
echo "  - IAM Roles: ecsTaskExecutionRole, ${PROJECT_NAME}-task-role"
echo "  - Security Groups: $ALB_SG_ID (ALB), $ECS_SG_ID (ECS)"
echo "  - Application Load Balancer: $ALB_DNS"
echo "  - Target Group: $TG_NAME"
echo ""
echo "Next steps:"
echo "  1. Store secrets in AWS Systems Manager Parameter Store:"
echo "     aws ssm put-parameter --name /ai-doc-chat/S3_BUCKET --value 'your-bucket' --type String"
echo "     aws ssm put-parameter --name /ai-doc-chat/UPSTAGE_API_KEY --value 'your-key' --type SecureString"
echo "     # ... (repeat for all secrets)"
echo ""
echo "  2. Update iam-policy-task-role.json with your actual S3 bucket name"
echo ""
echo "  3. Run the deployment script:"
echo "     source deployment-config.sh"
echo "     ./deploy.sh"
echo ""
echo "  4. Access your application at: http://$ALB_DNS"

