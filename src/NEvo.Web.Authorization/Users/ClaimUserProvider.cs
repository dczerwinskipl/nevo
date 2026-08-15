using System.Security.Claims;
using LanguageExt;
using NEvo.Authorization.Users;
using NEvo.Core;
using NEvo.Web.Authorization.Claims;

namespace NEvo.Web.Authorization.Users;

public abstract class ClaimUserProvider<TUser, TId>(IUserClaimsProvider userClaimsProvider) : IUserProvider<TUser, TId> where TUser : User<TId>
{
    protected const string UserId = "sub";
    protected const string UserName = "name";

    private readonly IUserClaimsProvider _userClaimsProvider = Check.Null(userClaimsProvider);

    public Option<TUser> GetUser()
        => _userClaimsProvider
            .GetUserClaims()
            .Bind(ToUser);

    protected abstract Option<TUser> ToUser(IEnumerable<Claim> claims);
}
