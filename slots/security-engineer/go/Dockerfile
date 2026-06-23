FROM golang:1.26-bookworm AS build
WORKDIR /src
COPY go.mod go.sum ./
RUN go mod download
COPY cmd ./cmd
COPY internal ./internal
RUN CGO_ENABLED=0 go build -trimpath -ldflags="-s -w" -o /out/ticketforge ./cmd/ticketforge

FROM gcr.io/distroless/static-debian12
WORKDIR /app
COPY --from=build /out/ticketforge /app/ticketforge
# migrate/seed read the contract at runtime; CONTRACT_DIR points at the mount.
ENV CONTRACT_DIR=/contract
EXPOSE 3000
HEALTHCHECK --interval=5s --timeout=3s --retries=10 \
  CMD ["/app/ticketforge", "healthcheck"]
ENTRYPOINT ["/app/ticketforge"]
CMD ["serve"]
