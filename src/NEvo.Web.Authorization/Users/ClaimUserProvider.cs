using System.Security.Claims;
using LanguageExt;
using NEvo.Authorization.Users;
using NEvo.Core;
using NEvo.Web.Authorization.Claims;

namespace NEvo.Web.Authorization.Users;

public class ClaimUserProvider<TId>(IUserClaimsProvider userClaimsProvider) : IUserProvider<TId>
{
    protected const string UserId = "sub";
    protected const string UserName = "name";

    private readonly IUserClaimsProvider _userClaimsProvider = Check.Null(userClaimsProvider);

    public Option<User<TId>> GetUser()
        => _userClaimsProvider
            .GetUserClaims()
            .Bind(ToUser);

    protected virtual Option<User<TId>> ToUser(IEnumerable<Claim> claims)
    {
        var idClaim = claims.GetClaimValue<TId>(UserId);
        var userNameClaim = claims.GetClaimValue(UserName);

        return from id in idClaim
               from userName in userNameClaim
               select new User<TId>(id, userName);
    }
}
