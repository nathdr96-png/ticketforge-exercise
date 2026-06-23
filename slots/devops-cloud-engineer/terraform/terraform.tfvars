# TicketForge — the committed deployment values.
#
# Everything an operator is expected to change lives here. No template in
# ./templates/ hard-codes an image tag, a replica count, a resource figure, a
# host name or a port, and NOTHING anywhere in this slot holds a credential:
# `app_secret_name` names a Secret that is created out of band.

name      = "ticketforge"
namespace = "ticketforge"

app_version    = "1.14.3"
config_version = "1.4.0"

registry          = "ghcr.io/ticketforge"
image_pull_policy = "IfNotPresent"

images = {
  api = {
    repository = "ticketforge-api"
    tag        = "1.14.3"
  }
  web = {
    repository = "ticketforge-web"
    tag        = "1.14.3"
  }
  # The sweeper is the same artifact as the API with a different entrypoint, so
  # it is deliberately the same tag. Two tags here would mean the sweeper and
  # the API could disagree about what a hold is.
  worker = {
    repository = "ticketforge-api"
    tag        = "1.14.3"
  }
}

hold_ttl_seconds = 600

api = {
  replicas    = 3
  port        = 3000
  health_path = "/health"
  resources = {
    requests = {
      cpu    = "250m"
      memory = "128Mi"
    }
    limits = {
      cpu = "1"
      # INFRA-92: tightened after the autumn capacity review so we fit more API
      # pods per node. Steady-state usage is well under this.
      memory = "192Mi"
    }
  }
  pdb_min_available = 2
}

web = {
  replicas    = 2
  port        = 8080
  health_path = "/"
  resources = {
    requests = {
      cpu    = "50m"
      memory = "64Mi"
    }
    limits = {
      cpu    = "250m"
      memory = "192Mi"
    }
  }
  pdb_min_available = 1
}

worker = {
  replicas               = 1
  sweep_interval_seconds = 15
  resources = {
    requests = {
      cpu    = "50m"
      memory = "96Mi"
    }
    limits = {
      cpu    = "250m"
      memory = "192Mi"
    }
  }
}

migrate = {
  backoff_limit           = 3
  active_deadline_seconds = 600
  resources = {
    requests = {
      cpu    = "100m"
      memory = "128Mi"
    }
    limits = {
      cpu    = "500m"
      memory = "256Mi"
    }
  }
}

app_secret_name = "ticketforge-app"

redis_url = "redis://ticketforge-redis.ticketforge.svc.cluster.local:6379"

ingress = {
  class_name           = "nginx"
  web_host             = "tickets.ticketforge.test"
  api_host             = "api.ticketforge.test"
  tls_secret_name      = "ticketforge-tls"
  controller_namespace = "ingress-nginx"
}

database_namespace = "data"
