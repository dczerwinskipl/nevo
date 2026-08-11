using Microsoft.Extensions.DependencyInjection;
using NEvo.ExampleApp.Documents.Api.Domain;
using NEvo.Messaging.Handling;

namespace NEvo.ExampleApp.Documents.Api;

public static class ServiceCollectionExtensions
{
    public static IServiceCollection AddDocumentsDomain(this IServiceCollection serviceCollection)
    {
        serviceCollection.Configure<MessageHandlerExtractorConfiguration>(options =>
        {
            options.Handlers.Add(typeof(GetDocumentQueryHandler));
        });
        return serviceCollection;
    }
}
