using Microsoft.EntityFrameworkCore;
using NEvo.EntityFramework.Migrations;

namespace Microsoft.Extensions.DependencyInjection;

public static class ServiceCollectionExtensions
{
    public static IServiceCollection AddMigrationWorker<TDbContext>(this IServiceCollection serviceCollection) where TDbContext : DbContext
    {
        serviceCollection.AddHostedService<MigrationBackgroundService<TDbContext>>();
        return serviceCollection;
    }
}
