import image

_name = option("name") or "magnetron"
_namespace = option("namespace") or "default"
_replicas = option("replicas") or 1
_container_port = option("container_port") or 8080
_service_port = option("service_port") or _container_port
_config_map_name = option("config_map_name") or ""
_secret_name = option("secret_name") or ""
_extra_env = option("extra_env") or []

_env_from = [
    item
    for item in [
        if _config_map_name:
            {
                configMapRef.name = _config_map_name
            }
        if _secret_name:
            {
                secretRef.name = _secret_name
            }
    ]
]

items = [
    {
        apiVersion = "apps/v1"
        kind = "Deployment"
        metadata = {
            name = _name
            namespace = _namespace
            labels.app = _name
        }
        spec = {
            replicas = _replicas
            selector.matchLabels.app = _name
            template = {
                metadata.labels.app = _name
                spec = {
                    securityContext = {
                        runAsNonRoot = True
                        runAsUser = 65532
                        runAsGroup = 65532
                        seccompProfile.type = "RuntimeDefault"
                    }
                    containers = [
                        {
                            name = _name
                            image = image.ref
                            securityContext = {
                                allowPrivilegeEscalation = False
                                capabilities.drop = ["ALL"]
                            }
                            ports = [
                                {
                                    name = "http"
                                    containerPort = _container_port
                                }
                            ]
                            env = _extra_env
                            envFrom = _env_from
                            livenessProbe = {
                                httpGet = {
                                    path = "/healthz"
                                    port = "http"
                                }
                            }
                            readinessProbe = {
                                httpGet = {
                                    path = "/readyz"
                                    port = "http"
                                }
                            }
                        }
                    ]
                }
            }
        }
    }
    {
        apiVersion = "v1"
        kind = "Service"
        metadata = {
            name = _name
            namespace = _namespace
            labels.app = _name
        }
        spec = {
            selector.app = _name
            ports = [
                {
                    name = "http"
                    port = _service_port
                    targetPort = "http"
                }
            ]
        }
    }
]
