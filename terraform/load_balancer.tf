# Internet-facing HTTP Application Load Balancer forwarding port 80 to K3s Gateway NodePort.

resource "aws_lb" "main" {
  name                       = "${local.name_prefix}-alb"
  internal                   = false
  load_balancer_type         = "application"
  security_groups            = [aws_security_group.alb.id]
  subnets                    = aws_subnet.public[*].id
  drop_invalid_header_fields = true

  tags = {
    Name = "${local.name_prefix}-alb"
  }
}

resource "aws_lb_target_group" "gateway" {
  name        = "${local.name_prefix}-gw-tg"
  port        = local.gateway_nodeport
  protocol    = "HTTP"
  target_type = "instance"
  vpc_id      = aws_vpc.main.id

  health_check {
    enabled             = true
    protocol            = "HTTP"
    port                = "traffic-port"
    path                = "/health"
    matcher             = "200"
    interval            = 30
    timeout             = 5
    healthy_threshold   = 2
    unhealthy_threshold = 3
  }

  tags = {
    Name = "${local.name_prefix}-gw-tg"
  }
}

resource "aws_lb_target_group_attachment" "k3s" {
  target_group_arn = aws_lb_target_group.gateway.arn
  target_id        = aws_instance.k3s.id
  port             = local.gateway_nodeport
}

resource "aws_lb_listener" "http" {
  load_balancer_arn = aws_lb.main.arn
  port              = 80
  protocol          = "HTTP"

  default_action {
    type             = "forward"
    target_group_arn = aws_lb_target_group.gateway.arn
  }
}

