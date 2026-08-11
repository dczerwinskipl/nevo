using NEvo.ExampleApp.ServiceA.Api.ExampleDomain;

namespace NEvo.Messaging.Handling;

public static partial class ServiceCollectionExtensions
{
    // TODO: Create some point of NEvo Extensions to register those
    public static IServiceCollection AddServiceADomain(this IServiceCollection serviceCollection)
    {
        serviceCollection.Configure<MessageHandlerExtractorConfiguration>(options =>
        {
            options.Handlers.Add(typeof(SayHelloCommandHandler));
            options.Handlers.Add(typeof(MyEventHandlerA));
            options.Handlers.Add(typeof(MyEventHandlerB));
        });
        return serviceCollection;
    }
}
