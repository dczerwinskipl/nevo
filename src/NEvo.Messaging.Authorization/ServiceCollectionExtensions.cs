using Microsoft.Extensions.DependencyInjection.Extensions;
using NEvo.Authorization.Users;
using NEvo.Messaging.Authorization;

namespace Microsoft.Extensions.DependencyInjection;

public static class ServiceCollectionExtensions
{
    /// <summary>
    /// Registers a scoped <see cref="ICurrentUser{TId, TUser}"/> that reads the ambient
    /// authorization context for the current message invocation, idempotently.
    /// </summary>
    public static IServiceCollection AddCurrentUser<TId, TUser>(this IServiceCollection services) where TUser : User<TId>
    {
        services.TryAddScoped<ICurrentUser<TId, TUser>, CurrentUser<TId, TUser>>();
        return services;
    }
}
