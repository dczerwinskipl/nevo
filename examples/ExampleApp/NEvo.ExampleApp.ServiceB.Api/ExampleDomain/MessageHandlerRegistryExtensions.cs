using NEvo.ExampleApp.ServiceB.Api.ExampleDomain;

namespace NEvo.Messaging.Handling;

public static partial class MessageHandlerRegistryExtensions
{
    // TODO: Create some point of NEvo Extensions to register those
    public static IMessageHandlerRegistry UseExampleDomain(this IMessageHandlerRegistry registry)
    {
        registry.Register<ServiceBCommandHandler>();

        return registry;
    }
}
