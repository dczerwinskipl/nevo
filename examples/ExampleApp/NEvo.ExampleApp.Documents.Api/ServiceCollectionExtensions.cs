using Microsoft.Extensions.DependencyInjection;
using NEvo.ExampleApp.Documents.Api.Domain;

namespace NEvo.Messaging.Handling;

public static partial class ServiceCollectionExtensions
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
