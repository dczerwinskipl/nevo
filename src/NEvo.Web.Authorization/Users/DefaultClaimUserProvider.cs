using System.Security.Claims;
using LanguageExt;
using NEvo.Authorization.Users;
using NEvo.Web.Authorization.Claims;

namespace NEvo.Web.Authorization.Users;

/// <summary>
/// Maps the base <see cref="User{T}"/> shape directly from the <c>sub</c>/<c>name</c>
/// claims — the default mapping for a consumer that has no custom user type of its own.
/// A consumer with its own <c>TUser</c> derives from <see cref="ClaimUserProvider{TUser,TId}"/>
/// directly instead.
/// </summary>
public sealed class DefaultClaimUserProvider<TId>(IUserClaimsProvider userClaimsProvider) : ClaimUserProvider<User<TId>, TId>(userClaimsProvider)
{
    protected override Option<User<TId>> ToUser(IEnumerable<Claim> claims)
    {
        var idClaim = claims.GetClaimValue<TId>(UserId);
        var userNameClaim = claims.GetClaimValue(UserName);

        return from id in idClaim
               from userName in userNameClaim
               select new User<TId>(id, userName);
    }
}
