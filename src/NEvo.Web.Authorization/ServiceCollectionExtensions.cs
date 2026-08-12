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
    public static void AddClaimsAuthorization<TId, TUser, TUserProvider, TRoleDataScope>(this IServiceCollection services)
        where TUser : User<TId>
        where TUserProvider : class, IUserProvider<TUser, TId>
        where TRoleDataScope : AuthDataScope
    {
        services.TryAddScoped<IUserClaimsProvider, UserClaimsProvider>();
        services.TryAddScoped<IUserProvider<TUser, TId>, TUserProvider>();
        services.TryAddScoped<IRoleProvider<TRoleDataScope>, ClaimRoleProvider<TRoleDataScope>>();
        services.TryAddScoped<IPermissionProvider<TRoleDataScope>, PermissionProvider<TRoleDataScope>>();
    }
}
