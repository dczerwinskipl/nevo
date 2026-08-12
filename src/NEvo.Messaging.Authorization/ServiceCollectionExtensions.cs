using Microsoft.Extensions.DependencyInjection.Extensions;
using NEvo.Messaging.Authorization;

namespace Microsoft.Extensions.DependencyInjection;

public static class ServiceCollectionExtensions
{
    /// <summary>
    /// Registers <see cref="ICurrentUser{TId}"/>, scoped (matching
    /// <see cref="NEvo.Messaging.Context.IMessageContextAccessor"/>'s own ambient-per-
    /// operation lifetime), idempotently.
    /// </summary>
    public static IServiceCollection AddCurrentUser<TId>(this IServiceCollection services)
    {
        services.TryAddScoped<ICurrentUser<TId>, CurrentUser<TId>>();
        return services;
    }
}
