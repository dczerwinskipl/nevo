namespace NEvo.Messaging.Handling;

public class InterfaceBasedMessageHandlerExtractor(IEnumerable<IMessageHandlerFactory> factories) : IMessageHandlerExtractor
{

    /*private readonly Dictionary<Type, IMessageHandlerFactory> _factories = 
        factories
            .Where(f => f is IInterfaceBasedMessageHandlerFactory)
            .Cast<IInterfaceBasedMessageHandlerFactory>()
            .ToDictionary(f => f.ForInterface);*/

    public IDictionary<Type, IMessageHandler> ExtractMessageHandlers(Type type)
        => factories
            .Where(f => f.CanApply(type))
            .SelectMany(f => f.GetMessageHandlerDescriptions(type).Select(d => (Factory: f, Description: d)))
            .ToDictionary(i => i.Description.MessageType, i => i.Factory.Create(i.Description));
    /*=> type
        .GetInterfaces()
        .Where(handlerInterface =>  handlerInterface.IsGenericType && _factories.ContainsKey(handlerInterface.GetGenericTypeDefinition()))
        .Select(handlerInterface => (type, handlerInterface, _factories[handlerInterface.GetGenericTypeDefinition()]))
        .SelectMany(CreateMessageHandler)
        .ToDictionary(i => i.MessageType, i => i.MessageHandler);*/

   /* private IEnumerable<(Type MessageType, IMessageHandler MessageHandler)> CreateMessageHandler((Type handlerType, Type HandlerInterface, IInterfaceBasedMessageHandlerFactory Factory) input)
    {
        foreach (var messageHandlerDescription in input.Factory.GetMessageHandlerDescriptions(input.handlerType, input.HandlerInterface))
        {
            var handler = input.Factory.Create(messageHandlerDescription);
            yield return (messageHandlerDescription.MessageType, handler);
        }
    }*/
}