#!/bin/bash

# Deployment script for Bedrock KB Transformation Lambda

set -e

# Configuration
FUNCTION_NAME="bedrock-kb-transformation"
RUNTIME="python3.12"
HANDLER="lambda_function.lambda_handler"
TIMEOUT=300
MEMORY=512
REGION="us-east-1"
AWS_PROFILE="dongik2"

# Colors for output
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
NC='\033[0m' # No Color

echo -e "${GREEN}Deploying Bedrock KB Transformation Lambda${NC}"

# Check if AWS CLI is installed
if ! command -v aws &> /dev/null; then
    echo "AWS CLI not found. Please install it first."
    exit 1
fi

# Get AWS account ID
ACCOUNT_ID=$(aws sts get-caller-identity --profile $AWS_PROFILE --query Account --output text)
echo "AWS Account: $ACCOUNT_ID"

# Check if IAM role exists
ROLE_NAME="lambda-bedrock-kb-transformation-role"
ROLE_ARN="arn:aws:iam::${ACCOUNT_ID}:role/${ROLE_NAME}"

if ! aws iam get-role --role-name $ROLE_NAME --profile $AWS_PROFILE &> /dev/null; then
    echo -e "${YELLOW}Creating IAM role...${NC}"
    
    # Create trust policy
    cat > trust-policy.json <<EOF
{
  "Version": "2012-10-17",
  "Statement": [{
    "Effect": "Allow",
    "Principal": {
      "Service": "lambda.amazonaws.com"
    },
    "Action": "sts:AssumeRole"
  }]
}
EOF

    aws iam create-role \
        --role-name $ROLE_NAME \
        --assume-role-policy-document file://trust-policy.json \
        --profile $AWS_PROFILE
    
    # Attach basic execution policy
    aws iam attach-role-policy \
        --role-name $ROLE_NAME \
        --policy-arn arn:aws:iam::aws:policy/service-role/AWSLambdaBasicExecutionRole \
        --profile $AWS_PROFILE
    
    # Create and attach S3 policy
    cat > s3-policy.json <<EOF
{
  "Version": "2012-10-17",
  "Statement": [{
    "Effect": "Allow",
    "Action": [
      "s3:GetObject",
      "s3:PutObject"
    ],
    "Resource": "arn:aws:s3:::*bedrock-kb-intermediate*/*"
  }]
}
EOF

    aws iam put-role-policy \
        --role-name $ROLE_NAME \
        --policy-name S3Access \
        --policy-document file://s3-policy.json \
        --profile $AWS_PROFILE
    
    rm trust-policy.json s3-policy.json
    
    echo "Waiting for IAM role to propagate..."
    sleep 10
fi

# Package Lambda function
echo -e "${GREEN}Packaging Lambda function...${NC}"
zip -r function.zip lambda_function.py

# Check if function exists
if aws lambda get-function --function-name $FUNCTION_NAME --region $REGION --profile $AWS_PROFILE &> /dev/null; then
    echo -e "${YELLOW}Updating existing function...${NC}"
    aws lambda update-function-code \
        --function-name $FUNCTION_NAME \
        --zip-file fileb://function.zip \
        --region $REGION \
        --profile $AWS_PROFILE
    
    aws lambda update-function-configuration \
        --function-name $FUNCTION_NAME \
        --timeout $TIMEOUT \
        --memory-size $MEMORY \
        --region $REGION \
        --profile $AWS_PROFILE
else
    echo -e "${YELLOW}Creating new function...${NC}"
    aws lambda create-function \
        --function-name $FUNCTION_NAME \
        --runtime $RUNTIME \
        --role $ROLE_ARN \
        --handler $HANDLER \
        --zip-file fileb://function.zip \
        --timeout $TIMEOUT \
        --memory-size $MEMORY \
        --region $REGION \
        --profile $AWS_PROFILE
fi

# Clean up
rm function.zip

echo -e "${GREEN}Deployment complete!${NC}"
echo ""
echo "Function ARN: arn:aws:lambda:${REGION}:${ACCOUNT_ID}:function:${FUNCTION_NAME}"
echo ""
echo "Next steps:"
echo "1. Create S3 bucket for intermediate storage (if not exists)"
echo "2. Configure this Lambda in your Bedrock Knowledge Base"
echo "3. Set chunking strategy to 'No chunking'"
echo ""
echo "To test:"
echo "aws lambda invoke --function-name $FUNCTION_NAME --payload file://test-event.json response.json --profile $AWS_PROFILE"
