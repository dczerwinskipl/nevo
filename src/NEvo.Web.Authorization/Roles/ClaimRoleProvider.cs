using System.Text.Json;
using LanguageExt;
using NEvo.Authorization;
using NEvo.Authorization.Roles;
using NEvo.Core;
using NEvo.Web.Authorization.Claims;

namespace NEvo.Web.Authorization.Roles;

public class ClaimRoleProvider<T>(IUserClaimsProvider userClaimsProvider) : IRoleProvider<T>
    where T : AuthDataScope
{
    protected const string RoleClaimType = "role";

    private readonly IUserClaimsProvider _userClaimsProvider = Check.Null(userClaimsProvider);

    public IEnumerable<Role<T>> GetRoles()
        => _userClaimsProvider
            .GetUserClaims()
            .Match(
                Some: claims => claims
                    .GetClaimValues(RoleClaimType)
                    .Select(x => ParseRoleFromJson(x.Value))
                    .Choose(o => o),
                None: Enumerable.Empty<Role<T>>
            ).ToList();

    private Option<Role<T>> ParseRoleFromJson(string rolesJson)
    {
        try
        {
            var role = JsonSerializer.Deserialize<Role<T>>(rolesJson, new JsonSerializerOptions
            {
                PropertyNameCaseInsensitive = true
            });

            if (role is null or { Name: null } or { DataScope: null })
            {
                return Option<Role<T>>.None;
            }

            return role;
        }
        catch
        {
            return Option<Role<T>>.None;
        }
    }
}