terraform {
  required_version = ">= 1.6.0"

  required_providers {
    # The ONLY provider this configuration needs.
    #
    # Terraform is used here as what it is for this family — a renderer. It
    # resolves the variables, builds the manifests from the templates in
    # ./templates/ and writes the artifact set the grader reads. No cluster is
    # contacted, no cloud credential exists, and `terraform apply` is therefore
    # safe to run anywhere, including in CI on a pull request from a fork.
    #
    # The alternative — the kubernetes provider, with `kubernetes_manifest`
    # resources — needs a live API server even to produce a plan, which would
    # make this slot ungradeable without a cluster and would grade the cluster.
    local = {
      source  = "hashicorp/local"
      version = "~> 2.5"
    }
  }
}
