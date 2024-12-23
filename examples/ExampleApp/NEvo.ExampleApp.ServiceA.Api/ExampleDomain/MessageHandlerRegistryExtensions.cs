using NEvo.ExampleApp.ServiceA.Api.ExampleDomain;

namespace NEvo.Messaging.Handling;

public static partial class MessageHandlerRegistryExtensions
{
    // TODO: Create some point of NEvo Extensions to register those
    public static IMessageHandlerRegistry UseServiceADomain(this IMessageHandlerRegistry registry)
    {
        registry.Register<SayHelloCommandHandler>();
        registry.Register<MyEventHandlerA>();
        registry.Register<MyEventHandlerB>();

        return registry;
    }
}
