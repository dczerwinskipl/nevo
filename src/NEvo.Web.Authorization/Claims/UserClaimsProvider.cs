using System.Security.Claims;
using LanguageExt;
using Microsoft.AspNetCore.Http;
using NEvo.Core;

namespace NEvo.Web.Authorization.Claims;

public class UserClaimsProvider(IHttpContextAccessor httpContextAccessor) : IUserClaimsProvider
{
    private readonly IHttpContextAccessor _httpContextAccessor = Check.Null(httpContextAccessor);

    public Option<IEnumerable<Claim>> GetUserClaims()
    {
        var user = _httpContextAccessor.HttpContext?.User;

        if (user is not null && user.Identity is not null && user.Identity.IsAuthenticated)
        {
            return Option<IEnumerable<Claim>>.Some(user.Claims);
        }

        return Option<IEnumerable<Claim>>.None;
    }
}
