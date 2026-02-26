import { NestFactory } from '@nestjs/core';
import { ValidationPipe } from '@nestjs/common';
import { DocumentBuilder, SwaggerModule } from '@nestjs/swagger';
import { AppModule } from './app.module';
import dataSource from './config/typeorm.config';
import { runAllSeeds } from './database/seeds';

async function bootstrap() {
  try {
    console.log('==========================================');
    console.log('Starting application bootstrap...');
    console.log('==========================================');
    console.log('Environment:', {
      NODE_ENV: process.env.NODE_ENV,
      PORT: process.env.PORT,
      DB_HOST: process.env.DB_HOST,
      DB_PORT: process.env.DB_PORT,
      DB_DATABASE: process.env.DB_DATABASE,
      DB_USERNAME: process.env.DB_USERNAME,
      DB_SCHEMA: process.env.DB_SCHEMA,
      JWT_SECRET: process.env.JWT_SECRET ? '***SET***' : 'NOT SET',
      JWT_EXPIRATION: process.env.JWT_EXPIRATION,
    });
    console.log('==========================================');

    console.log('Creating NestJS application...');
    const app = await NestFactory.create(AppModule, {
      logger: ['error', 'warn', 'log', 'debug', 'verbose'],
    });
    console.log('✅ AppModule created successfully');

    console.log('Setting up global validation pipe...');
    app.useGlobalPipes(
      new ValidationPipe({
        whitelist: true,
        forbidNonWhitelisted: true,
        transform: true,
      }),
    );
    console.log('✅ Validation pipe configured');

    console.log('Setting up Swagger...');
    const config = new DocumentBuilder()
      .setTitle('CollMind TPM Backend')
      .setDescription('CollMind TPM Backend API Documentation')
      .setVersion('1.0')
      .addBearerAuth()
      .build();
    const document = SwaggerModule.createDocument(app, config);
    SwaggerModule.setup('api', app, document);
    console.log('✅ Swagger configured');

    console.log('Setting up CORS...');
    app.enableCors({
      origin: true, // Allow all origins in development
      methods: ['GET', 'POST', 'PUT', 'PATCH', 'DELETE', 'OPTIONS'],
      allowedHeaders: ['Content-Type', 'Authorization', 'x-tenant-id'],
      credentials: true,
    });
    console.log('✅ CORS configured');

    const port = process.env.PORT || 8080;
    // Use '0.0.0.0' for production/containers, 'localhost' for local development
    const host = process.env.NODE_ENV === 'production' ? '0.0.0.0' : 'localhost';
    const displayHost = process.env.NODE_ENV === 'production' ? '0.0.0.0' : 'localhost';
    console.log(`==========================================`);
    console.log(`Starting server on port ${port}...`);
    console.log(`==========================================`);
    await app.listen(port, host);
    console.log(`✅ Application is running on: http://${displayHost}:${port}`);
    console.log(`✅ Swagger documentation: http://${displayHost}:${port}/api`);
    console.log(`✅ Health check: http://${displayHost}:${port}/`);
    console.log(`==========================================`);

    // Run migrations and seeds after app starts (non-blocking)
    if (process.env.NODE_ENV === 'production') {
      console.log('Scheduling migrations and seeds...');
      runMigrationsAndSeeds().catch((error) => {
        console.error('❌ Migration/Seed failed:', error);
        // Don't exit - app is already running
      });
    }
  } catch (error) {
    console.error('==========================================');
    console.error('❌ Fatal error during bootstrap:', error);
    console.error('Error stack:', error instanceof Error ? error.stack : 'No stack trace');
    console.error('==========================================');
    throw error;
  }
}

async function runMigrationsAndSeeds() {
  try {
    // Initialize DataSource if not already initialized
    if (!dataSource.isInitialized) {
      await dataSource.initialize();
    }

    // Run migrations
    console.log('Running database migrations...');
    await dataSource.runMigrations();
    console.log('Migrations completed successfully');

    // Wait 3 seconds before running seeds
    console.log('Waiting 3 seconds before running seeds...');
    await new Promise((resolve) => setTimeout(resolve, 3000));

    // Run seeds (using the same DataSource connection)
    console.log('Running database seeds...');
    await runAllSeeds(dataSource);
    console.log('Seeds completed successfully');

    // Clean up connection
    if (dataSource.isInitialized) {
      await dataSource.destroy();
    }
  } catch (error) {
    console.error('Migration/Seed error:', error);
    // Clean up connection even on error
    if (dataSource.isInitialized) {
      try {
        await dataSource.destroy();
      } catch (destroyError) {
        console.error('Error destroying dataSource:', destroyError);
      }
    }
    throw error;
  }
}

bootstrap().catch((error) => {
  console.error('Failed to start application:', error);
  process.exit(1);
});


