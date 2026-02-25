import { NestFactory } from '@nestjs/core';
import { ValidationPipe } from '@nestjs/common';
import { DocumentBuilder, SwaggerModule } from '@nestjs/swagger';
import { AppModule } from './app.module';
import dataSource from './config/typeorm.config';

async function bootstrap() {
  // Run migrations before starting the app
  if (process.env.NODE_ENV === 'production') {
    try {
      console.log('Running database migrations...');
      if (!dataSource.isInitialized) {
        await dataSource.initialize();
      }
      await dataSource.runMigrations();
      console.log('Migrations completed successfully');
      if (dataSource.isInitialized) {
        await dataSource.destroy();
      }
    } catch (error) {
      console.error('Migration failed:', error);
      // Continue anyway - migrations might already be applied
    }
  }

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

  const port = process.env.PORT || 3000;
  await app.listen(port);
  console.log(`Application is running on: http://localhost:${port}`);
  console.log(`Swagger documentation: http://localhost:${port}/api`);
}
bootstrap();


