using LanguageExt;

namespace NEvo.Web.Client;

public class NoAuthenticationStrategy : IAuthenticationStrategy
{
    public Task<Either<Exception, HttpClient>> AuthenticateHttpClientAsync(HttpClient client)
        => Task.FromResult(Either<Exception, HttpClient>.Right(client));
}
