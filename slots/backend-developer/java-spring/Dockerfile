# --- build ----------------------------------------------------------------
FROM maven:3.9-eclipse-temurin-21 AS build
WORKDIR /build
# Dependency layer first so source edits don't re-resolve the world.
COPY pom.xml ./
RUN mvn -B -q dependency:go-offline
COPY src ./src
RUN mvn -B -q -DskipTests package

# --- runtime --------------------------------------------------------------
FROM eclipse-temurin:21-jre-noble
WORKDIR /app
ENV PORT=3000 \
    JAVA_TOOL_OPTIONS="-XX:MaxRAMPercentage=75"
COPY --from=build /build/target/ticketforge-java-spring.jar ./app.jar
# migrate/seed read contract/schema.sql and contract/seed/*.json at runtime; mount the
# repo's contract/ directory here (docker compose does this for the harness).
ENV CONTRACT_DIR=/contract
EXPOSE 3000
HEALTHCHECK --interval=5s --timeout=3s --retries=20 \
  CMD ["sh", "-c", "exec 3<>/dev/tcp/127.0.0.1/${PORT} && printf 'GET /health HTTP/1.0\\r\\n\\r\\n' >&3 && head -n1 <&3 | grep -q 200"]
ENTRYPOINT ["sh", "-c", "exec java -jar /app/app.jar --server.port=${PORT}"]
