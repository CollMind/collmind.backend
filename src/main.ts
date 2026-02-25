import { NestFactory } from '@nestjs/core';
import { ValidationPipe } from '@nestjs/common';
import { DocumentBuilder, SwaggerModule } from '@nestjs/swagger';
import { AppModule } from './app.module';
import dataSource from './config/typeorm.config';
import { runAllSeeds } from './database/seeds';

async function bootstrap() {
  const app = await NestFactory.create(AppModule);

  // Global validation pipe
  app.useGlobalPipes(
    new ValidationPipe({
      whitelist: true,
      forbidNonWhitelisted: true,
      transform: true,
    }),
  );

  // Swagger configuration
  const config = new DocumentBuilder()
    .setTitle('CollMind TPM Backend')
    .setDescription('CollMind TPM Backend API Documentation')
    .setVersion('1.0')
    .addBearerAuth()
    .build();
  const document = SwaggerModule.createDocument(app, config);
  SwaggerModule.setup('api', app, document);

  // CORS configuration
  app.enableCors({
    origin: true, // Allow all origins in development
    methods: ['GET', 'POST', 'PUT', 'PATCH', 'DELETE', 'OPTIONS'],
    allowedHeaders: ['Content-Type', 'Authorization', 'x-tenant-id'],
    credentials: true,
  });

  const port = process.env.PORT || 8080;
  await app.listen(port);
  console.log(`Application is running on: http://localhost:${port}`);
  console.log(`Swagger documentation: http://localhost:${port}/api`);

  // Run migrations and seeds after app starts (non-blocking)
  if (process.env.NODE_ENV === 'production') {
    runMigrationsAndSeeds().catch((error) => {
      console.error('Migration/Seed failed:', error);
      // Don't exit - app is already running
    });
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

bootstrap();


