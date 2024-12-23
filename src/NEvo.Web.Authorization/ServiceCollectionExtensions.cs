using Microsoft.Extensions.DependencyInjection;
using Microsoft.Extensions.DependencyInjection.Extensions;
using NEvo.Authorization;
using NEvo.Authorization.Permissions;
using NEvo.Authorization.Roles;
using NEvo.Authorization.Users;
using NEvo.Web.Authorization.Claims;
using NEvo.Web.Authorization.Roles;
using NEvo.Web.Authorization.Users;

namespace Microsoft.Extensions.DependencyInjection;

public static class ServiceCollectionExtensions
{
    public static void AddClaimsAuthorization<TId, TRoleDataScope>(this IServiceCollection services)
        where TRoleDataScope : AuthDataScope
    {
        services.TryAddScoped<IUserClaimsProvider, UserClaimsProvider>();
        services.TryAddScoped<IUserProvider<TId>, ClaimUserProvider<TId>>();
        services.TryAddScoped<IRoleProvider<TRoleDataScope>, ClaimRoleProvider<TRoleDataScope>>();
        services.TryAddScoped<IPermissionProvider<TRoleDataScope>, PermissionProvider<TRoleDataScope>>();
    }
}
