import { NestFactory } from '@nestjs/core';
import { DocumentBuilder, SwaggerModule } from '@nestjs/swagger';
import { AppModule } from './app.module';
import { requestTimingMiddleware } from './common/request-timing.middleware';

async function bootstrap(): Promise<void> {
  const app = await NestFactory.create(AppModule);

  // Times every request (Server-Timing header + slow-request log).
  app.use(requestTimingMiddleware);

  /*
   * ============================================================
   * CORS CONFIGURATION
   * ============================================================
   *
   * CORS_ORIGINS supports multiple frontend URLs separated
   * by commas.
   *
   * Local example:
   * CORS_ORIGINS=http://localhost:3000,http://localhost:3001
   *
   * Production example:
   * CORS_ORIGINS=https://zos-web-production.example.com
   */

  const configuredOrigins = String(process.env.CORS_ORIGINS || '')
    .split(',')
    .map((origin) => origin.trim().replace(/\/+$/, ''))
    .filter(Boolean);

  /*
   * These origins are always explicitly supported.
   */
  const defaultAllowedOrigins = [
    'http://localhost:3000',
    'http://localhost:3001',
    'http://127.0.0.1:3000',
    'http://127.0.0.1:3001',
  ];

  const allowedOrigins = Array.from(
    new Set([
      ...defaultAllowedOrigins,
      ...configuredOrigins,
    ]),
  );

  /*
   * During local development we also allow localhost/127.0.0.1
   * on any port.
   *
   * This avoids CORS breaking simply because Next.js starts on
   * 3001, 3002, etc.
   *
   * Production URLs still need to be explicitly present inside
   * CORS_ORIGINS.
   */
  const isLocalDevelopment =
    process.env.NODE_ENV !== 'production';

  app.enableCors({
    origin: (origin, callback) => {
      /*
       * Requests from Swagger, Postman, server-to-server calls,
       * curl etc. may not contain an Origin header.
       */
      if (!origin) {
        return callback(null, true);
      }

      /*
       * Remove accidental trailing slash before comparing.
       */
      const normalizedOrigin = origin.replace(/\/+$/, '');

      /*
       * Explicitly configured origins.
       */
      if (allowedOrigins.includes(normalizedOrigin)) {
        return callback(null, true);
      }

      /*
       * Local development:
       * allow localhost and 127.0.0.1 on any port.
       */
      if (
        isLocalDevelopment &&
        (
          /^http:\/\/localhost:\d+$/.test(normalizedOrigin) ||
          /^http:\/\/127\.0\.0\.1:\d+$/.test(normalizedOrigin)
        )
      ) {
        return callback(null, true);
      }

      console.warn(
        `[CORS] Blocked origin: ${normalizedOrigin}`,
      );

      return callback(
        new Error(
          `CORS policy does not allow origin: ${normalizedOrigin}`,
        ),
        false,
      );
    },

    methods: [
      'GET',
      'POST',
      'PUT',
      'PATCH',
      'DELETE',
      'OPTIONS',
    ],

    allowedHeaders: [
      'Content-Type',
      'Authorization',
      'Accept',
      'Origin',
      'X-Requested-With',
      'X-Request-ID',
      'Cache-Control',
      'Pragma',
    ],

    exposedHeaders: [
      'X-Request-ID',
    ],

    /*
     * Keep this enabled because ZOS uses authenticated requests.
     */
    credentials: true,

    /*
     * Browser preflight OPTIONS requests will return 204.
     */
    optionsSuccessStatus: 204,

    /*
     * Cache successful preflight result for 1 hour.
     * This also reduces unnecessary OPTIONS requests.
     */
    maxAge: 3600,
  });

  /*
   * ============================================================
   * SWAGGER
   * ============================================================
   *
   * Enabled automatically during local development.
   *
   * To enable on staging/production:
   *
   * ENABLE_SWAGGER=true
   */

  const swaggerEnabled =
    process.env.NODE_ENV !== 'production' ||
    process.env.ENABLE_SWAGGER === 'true';

  if (swaggerEnabled) {
    const swaggerConfig = new DocumentBuilder()
      .setTitle('ZOS Backend API')
      .setDescription(
        'API documentation for Zobocon Operating System backend',
      )
      .setVersion('1.0')
      .addBearerAuth(
        {
          type: 'http',
          scheme: 'bearer',
          bearerFormat: 'JWT',
        },
        'access-token',
      )
      .build();

    const swaggerDocument =
      SwaggerModule.createDocument(
        app,
        swaggerConfig,
      );

    SwaggerModule.setup(
      'api/docs',
      app,
      swaggerDocument,
    );
  }

  /*
   * ============================================================
   * SERVER
   * ============================================================
   *
   * Render automatically provides PORT.
   *
   * Locally:
   * 3000 will be used unless PORT is explicitly provided.
   */

  const port = Number(
    process.env.PORT ?? 3000,
  );

  /*
   * 0.0.0.0 is required for Render/container deployment.
   */
  await app.listen(
    port,
    '0.0.0.0',
  );

  console.log('');
  console.log('========================================');
  console.log('ZOS BACKEND STARTED');
  console.log('========================================');
  console.log(`Port: ${port}`);
  console.log(
    `Environment: ${
      process.env.NODE_ENV ?? 'development'
    }`,
  );

  console.log(
    `Allowed CORS origins: ${
      allowedOrigins.join(', ')
    }`,
  );

  if (isLocalDevelopment) {
    console.log(
      'Local CORS: localhost/127.0.0.1 allowed on any port',
    );
  }

  if (swaggerEnabled) {
    console.log(
      `Swagger: http://localhost:${port}/api/docs`,
    );
  }

  console.log('========================================');
  console.log('');
}

bootstrap().catch(
  (error: unknown) => {
    console.error(
      'Failed to start ZOS backend:',
      error,
    );

    process.exit(1);
  },
);