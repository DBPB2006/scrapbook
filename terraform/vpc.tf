# Core VPC and subnets in ap-south-1 (2 public subnets across 2 AZs, 2 private subnets in AZ1).

resource "aws_vpc" "main" {
  cidr_block           = var.vpc_cidr
  enable_dns_support   = true
  enable_dns_hostnames = true

  tags = {
    Name = "${local.name_prefix}-vpc"
  }
}

resource "aws_subnet" "public" {
  count = 2

  vpc_id                  = aws_vpc.main.id
  cidr_block              = var.public_subnet_cidrs[count.index]
  availability_zone       = var.availability_zones[count.index]
  map_public_ip_on_launch = true

  tags = {
    Name = "${local.name_prefix}-public-${count.index == 0 ? "a" : "b"}"
  }
}

resource "aws_subnet" "private_app" {
  vpc_id            = aws_vpc.main.id
  cidr_block        = var.private_app_subnet_cidr
  availability_zone = var.availability_zones[0]

  tags = {
    Name = "${local.name_prefix}-private-app"
  }
}

resource "aws_subnet" "private_db" {
  vpc_id            = aws_vpc.main.id
  cidr_block        = var.private_db_subnet_cidr
  availability_zone = var.availability_zones[0]

  tags = {
    Name = "${local.name_prefix}-private-db"
  }
}

