#!/bin/bash

# CollMind TPM Backend Test Setup Script
# Bu script test ortamını hazırlar

set -e

echo "🚀 CollMind TPM Backend Test Setup"
echo "===================================="

# Colors
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
RED='\033[0;31m'
NC='\033[0m' # No Color

# Check if .env exists
if [ ! -f .env ]; then
    echo -e "${YELLOW}⚠️  .env file not found. Creating from template...${NC}"
    cat > .env << EOF
NODE_ENV=development
PORT=3000

DB_HOST=localhost
DB_PORT=5432
DB_USERNAME=postgres
DB_PASSWORD=postgres
DB_DATABASE=collmind_tpm
DB_SCHEMA=main

JWT_SECRET=your-secret-key-change-in-production-min-32-chars-please
JWT_EXPIRES_IN=1d
EOF
    echo -e "${GREEN}✅ .env file created${NC}"
    echo -e "${YELLOW}⚠️  Please update JWT_SECRET in .env file!${NC}"
fi

# Check if node_modules exists
if [ ! -d "node_modules" ]; then
    echo -e "${YELLOW}📦 Installing dependencies...${NC}"
    npm install
    echo -e "${GREEN}✅ Dependencies installed${NC}"
else
    echo -e "${GREEN}✅ Dependencies already installed${NC}"
fi

# Check PostgreSQL connection
echo -e "${YELLOW}🔍 Checking PostgreSQL connection...${NC}"
if command -v psql &> /dev/null; then
    if PGPASSWORD=postgres psql -h localhost -U postgres -d collmind_tpm -c "SELECT 1" &> /dev/null; then
        echo -e "${GREEN}✅ PostgreSQL connection successful${NC}"
    else
        echo -e "${RED}❌ PostgreSQL connection failed${NC}"
        echo -e "${YELLOW}Please ensure PostgreSQL is running and database 'collmind_tpm' exists${NC}"
        exit 1
    fi
else
    echo -e "${YELLOW}⚠️  psql not found. Skipping connection check.${NC}"
fi

# Run migrations
echo -e "${YELLOW}🔄 Running migrations...${NC}"
npm run migration:run
echo -e "${GREEN}✅ Migrations completed${NC}"

# Check if migrations were successful
if [ $? -eq 0 ]; then
    echo -e "${GREEN}✅ Setup completed successfully!${NC}"
    echo ""
    echo "Next steps:"
    echo "1. Start backend: npm run start:dev"
    echo "2. Open Swagger UI: http://localhost:3000/api"
    echo "3. Test endpoints using Swagger UI"
else
    echo -e "${RED}❌ Migration failed${NC}"
    exit 1
fi
