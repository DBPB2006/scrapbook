# Three private EC2 instances (K3s, Jenkins, MongoDB) and persistent MongoDB EBS data volume.

data "aws_ami" "al2023" {
  most_recent = true
  owners      = ["amazon"]

  filter {
    name   = "name"
    values = ["al2023-ami-2023.*-x86_64"]
  }

  filter {
    name   = "architecture"
    values = ["x86_64"]
  }

  filter {
    name   = "virtualization-type"
    values = ["hvm"]
  }

  filter {
    name   = "root-device-type"
    values = ["ebs"]
  }
}

# --- 1. Single-Node Private K3s EC2 Instance ----------------------------------

resource "aws_instance" "k3s" {
  ami                         = data.aws_ami.al2023.id
  instance_type               = var.k3s_instance_type
  subnet_id                   = aws_subnet.private_app.id
  vpc_security_group_ids      = [aws_security_group.k3s.id]
  iam_instance_profile        = aws_iam_instance_profile.k3s.name
  associate_public_ip_address = false

  credit_specification {
    cpu_credits = "standard"
  }

  # Hop limit 2 enforces IMDSv2 while allowing pods in container network namespaces
  # to assume the K3s instance profile for private S3 media access.
  metadata_options {
    http_endpoint               = "enabled"
    http_tokens                 = "required"
    http_put_response_hop_limit = 2
  }

  root_block_device {
    volume_type           = "gp3"
    volume_size           = 20
    encrypted             = true
    delete_on_termination = true
  }

  user_data = file("${path.module}/user_data/k3s.sh")

  tags = {
    Name = "${local.name_prefix}-k3s"
  }

  lifecycle {
    ignore_changes = [ami]
  }
}

# --- 2. Private Jenkins EC2 Instance ------------------------------------------

resource "aws_instance" "jenkins" {
  ami                         = data.aws_ami.al2023.id
  instance_type               = var.jenkins_instance_type
  subnet_id                   = aws_subnet.private_app.id
  vpc_security_group_ids      = [aws_security_group.jenkins.id]
  iam_instance_profile        = aws_iam_instance_profile.jenkins.name
  associate_public_ip_address = false

  credit_specification {
    cpu_credits = "standard"
  }

  metadata_options {
    http_endpoint               = "enabled"
    http_tokens                 = "required"
    http_put_response_hop_limit = 1
  }

  root_block_device {
    volume_type           = "gp3"
    volume_size           = 20
    encrypted             = true
    delete_on_termination = true
  }

  user_data = file("${path.module}/user_data/jenkins.sh")

  tags = {
    Name = "${local.name_prefix}-jenkins"
  }

  lifecycle {
    ignore_changes = [ami]
  }
}

# --- 3. Private MongoDB EC2 Instance & Persistent Encrypted EBS Volume --------

resource "aws_instance" "mongodb" {
  ami                         = data.aws_ami.al2023.id
  instance_type               = var.mongodb_instance_type
  subnet_id                   = aws_subnet.private_db.id
  vpc_security_group_ids      = [aws_security_group.mongodb.id]
  iam_instance_profile        = aws_iam_instance_profile.mongodb.name
  associate_public_ip_address = false

  credit_specification {
    cpu_credits = "standard"
  }

  metadata_options {
    http_endpoint               = "enabled"
    http_tokens                 = "required"
    http_put_response_hop_limit = 1
  }

  root_block_device {
    volume_type           = "gp3"
    volume_size           = 10
    encrypted             = true
    delete_on_termination = true
  }

  user_data = templatefile("${path.module}/user_data/mongodb.sh", {
    mongodb_port = local.mongodb_port
  })

  tags = {
    Name = "${local.name_prefix}-mongodb"
  }

  lifecycle {
    ignore_changes = [ami]
  }
}

resource "aws_ebs_volume" "mongodb_data" {
  availability_zone = aws_subnet.private_db.availability_zone
  size              = var.mongodb_data_volume_size
  type              = "gp3"
  encrypted         = true

  tags = {
    Name = "${local.name_prefix}-mongodb-data"
  }

  lifecycle {
    prevent_destroy = true
  }
}

resource "aws_volume_attachment" "mongodb_data" {
  device_name = "/dev/xvdf"
  volume_id   = aws_ebs_volume.mongodb_data.id
  instance_id = aws_instance.mongodb.id
}

