using Microsoft.Extensions.DependencyInjection.Extensions;
using NEvo.Messaging.Authorization;

namespace Microsoft.Extensions.DependencyInjection;

public static class ServiceCollectionExtensions
{
    /// <summary>
    /// Registers a scoped <see cref="ICurrentUser{TId}"/> that reads the ambient
    /// authorization context for the current message invocation, idempotently.
    /// </summary>
    public static IServiceCollection AddCurrentUser<TId>(this IServiceCollection services)
    {
        services.TryAddScoped<ICurrentUser<TId>, CurrentUser<TId>>();
        return services;
    }
}
