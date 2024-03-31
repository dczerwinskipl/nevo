using LanguageExt;

namespace NEvo.Web.Client;

public interface IHttpClientServiceFactory
{
    Task<Either<Exception, HttpClient>> CreateClientAsync(string name);
}
