using NEvo.ExampleApp.ServiceB.Api.ExampleDomain;

namespace NEvo.Messaging.Handling;

public static partial class MessageHandlerRegistryExtensions
{
    // TODO: add configure extension to messaning 
    public static IServiceCollection AddExampleDomain(this IServiceCollection serviceCollection)
    {
        serviceCollection.Configure<MessageHandlerExtractorConfiguration>(options =>
        {
            options.Handlers.Add(typeof(ServiceBCommandHandler));
        });
        return serviceCollection;
    }
}
