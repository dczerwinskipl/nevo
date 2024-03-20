using NEvo.Messaging.EntityFramework;

namespace Microsoft.Extensions.DependencyInjection;

public static class ServiceCollectionExtensions
{
    public static IServiceCollection AddEntityFrameworkInbox<TDbContext>(this IServiceCollection services) where TDbContext : DbContext, IInboxDbContext
    {
        services.AddScoped<IMessageInbox, EntityFrameworkMessageInbox>();
        services.AddScoped<IInboxDbContext>(sp => sp.GetRequiredService<TDbContext>());
        return services;
    }
}
