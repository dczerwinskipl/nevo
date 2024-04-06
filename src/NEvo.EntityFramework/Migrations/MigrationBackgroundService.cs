using Microsoft.EntityFrameworkCore;
using Microsoft.Extensions.DependencyInjection;
using Microsoft.Extensions.Hosting;
using Microsoft.Extensions.Logging;
using Polly;
using System.Diagnostics;

namespace NEvo.EntityFramework.Migrations;

public class MigrationBackgroundService<TDbContext>(ILogger<MigrationBackgroundService<TDbContext>> logger, IServiceProvider serviceProvider) : BackgroundService where TDbContext : DbContext
{
    private static readonly ActivitySource ActivitySource = new(Telemetry.Migration);

    protected override async Task ExecuteAsync(CancellationToken stoppingToken)
    {
        using var activity = ActivitySource.StartActivity("Migrating database", ActivityKind.Client);

        var retryPolicy = Policy
            .Handle<Exception>()
            .WaitAndRetryAsync(
                10,
                retryAttempt => TimeSpan.FromSeconds(retryAttempt),
                onRetry: (exception, timeSpan, retryCount, context) =>
                {
                    logger.LogWarning("Retry {RetryCount}: Encountered an error during DB migration. Retrying...", retryCount);
                    logger.LogWarning("Exception: {Message}", exception.Message);
                });

        await retryPolicy.ExecuteAsync(async () =>
        {
            using var activity = ActivitySource.StartActivity("Migrating database attempt", ActivityKind.Client);

            using var scope = serviceProvider.CreateScope();
            var dbContext = scope.ServiceProvider.GetRequiredService<TDbContext>();
            await dbContext.Database.MigrateAsync();
        });
    }
}
