using LanguageExt;

namespace NEvo.Web.Client;

public interface IAuthenticationStrategy
{
    Task<Either<Exception, HttpClient>> AuthenticateHttpClientAsync(HttpClient client);
}
