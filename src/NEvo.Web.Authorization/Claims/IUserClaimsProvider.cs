using System.Security.Claims;
using LanguageExt;

namespace NEvo.Web.Authorization.Claims;

public interface IUserClaimsProvider
{
    public Option<IEnumerable<Claim>> GetUserClaims();
}
