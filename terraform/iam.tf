# Three separate EC2 IAM roles & instance profiles: Jenkins, K3s, and MongoDB.

data "aws_partition" "current" {}

locals {
  ssm_policy_arn      = "arn:${data.aws_partition.current.partition}:iam::aws:policy/AmazonSSMManagedInstanceCore"
  ecr_repository_arns = [for name in local.ecr_repository_names : aws_ecr_repository.repositories[name].arn]
}

data "aws_iam_policy_document" "ec2_assume_role" {
  statement {
    actions = ["sts:AssumeRole"]

    principals {
      type        = "Service"
      identifiers = ["ec2.amazonaws.com"]
    }
  }
}

# --- 1. Jenkins IAM Role (SSM + ECR Push + Frontend S3) -----------------------

resource "aws_iam_role" "jenkins" {
  name               = "${local.name_prefix}-jenkins-role"
  assume_role_policy = data.aws_iam_policy_document.ec2_assume_role.json
  tags               = { Name = "${local.name_prefix}-jenkins-role" }
}

resource "aws_iam_role_policy_attachment" "jenkins_ssm" {
  role       = aws_iam_role.jenkins.name
  policy_arn = local.ssm_policy_arn
}

data "aws_iam_policy_document" "jenkins" {
  statement {
    actions   = ["ecr:GetAuthorizationToken"]
    resources = ["*"]
  }

  statement {
    actions = [
      "ecr:BatchCheckLayerAvailability",
      "ecr:BatchGetImage",
      "ecr:CompleteLayerUpload",
      "ecr:GetDownloadUrlForLayer",
      "ecr:InitiateLayerUpload",
      "ecr:PutImage",
      "ecr:UploadLayerPart",
    ]
    resources = local.ecr_repository_arns
  }

  statement {
    actions   = ["s3:ListBucket"]
    resources = [aws_s3_bucket.frontend.arn]
  }

  statement {
    actions   = ["s3:DeleteObject", "s3:GetObject", "s3:PutObject"]
    resources = ["${aws_s3_bucket.frontend.arn}/*"]
  }
}

resource "aws_iam_role_policy" "jenkins" {
  name   = "${local.name_prefix}-jenkins-policy"
  role   = aws_iam_role.jenkins.id
  policy = data.aws_iam_policy_document.jenkins.json
}

resource "aws_iam_instance_profile" "jenkins" {
  name = "${local.name_prefix}-jenkins-profile"
  role = aws_iam_role.jenkins.name
}

# --- 2. K3s IAM Role (SSM + ECR Pull + Private Media S3) ----------------------

resource "aws_iam_role" "k3s" {
  name               = "${local.name_prefix}-k3s-role"
  assume_role_policy = data.aws_iam_policy_document.ec2_assume_role.json
  tags               = { Name = "${local.name_prefix}-k3s-role" }
}

resource "aws_iam_role_policy_attachment" "k3s_ssm" {
  role       = aws_iam_role.k3s.name
  policy_arn = local.ssm_policy_arn
}

data "aws_iam_policy_document" "k3s" {
  statement {
    actions   = ["ecr:GetAuthorizationToken"]
    resources = ["*"]
  }

  statement {
    actions = [
      "ecr:BatchCheckLayerAvailability",
      "ecr:BatchGetImage",
      "ecr:GetDownloadUrlForLayer",
    ]
    resources = local.ecr_repository_arns
  }

  statement {
    actions = [
      "s3:AbortMultipartUpload",
      "s3:DeleteObject",
      "s3:GetObject",
      "s3:PutObject",
    ]
    resources = ["${aws_s3_bucket.media.arn}/*"]
  }
}

resource "aws_iam_role_policy" "k3s" {
  name   = "${local.name_prefix}-k3s-policy"
  role   = aws_iam_role.k3s.id
  policy = data.aws_iam_policy_document.k3s.json
}

resource "aws_iam_instance_profile" "k3s" {
  name = "${local.name_prefix}-k3s-profile"
  role = aws_iam_role.k3s.name
}

# --- 3. MongoDB IAM Role (SSM Only) -------------------------------------------

resource "aws_iam_role" "mongodb" {
  name               = "${local.name_prefix}-mongodb-role"
  assume_role_policy = data.aws_iam_policy_document.ec2_assume_role.json
  tags               = { Name = "${local.name_prefix}-mongodb-role" }
}

resource "aws_iam_role_policy_attachment" "mongodb_ssm" {
  role       = aws_iam_role.mongodb.name
  policy_arn = local.ssm_policy_arn
}

resource "aws_iam_instance_profile" "mongodb" {
  name = "${local.name_prefix}-mongodb-profile"
  role = aws_iam_role.mongodb.name
}

