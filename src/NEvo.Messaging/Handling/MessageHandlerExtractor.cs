namespace NEvo.Messaging.Handling;

public class MessageHandlerExtractor : IMessageHandlerExtractor
{
    private readonly IDictionary<Type, IMessageHandlerFactory> _factories;

    public MessageHandlerExtractor(IEnumerable<IMessageHandlerFactory> factories)
    {
        _factories = factories.ToDictionary(f => f.ForInterface);
    }

    public IDictionary<Type, IMessageHandler> ExtractMessageHandlers<THandler>()
        => typeof(THandler)
            .GetInterfaces()
            .Where(handlerInterface => handlerInterface.IsGenericType && _factories.Keys.Contains(handlerInterface.GetGenericTypeDefinition()))
            .Select(handlerInterface => (typeof(THandler), handlerInterface, _factories[handlerInterface.GetGenericTypeDefinition()]))
            .SelectMany(CreateMessageHandler)
            .ToDictionary(i => i.MessageType, i => i.MessageHandler);

    private IEnumerable<(Type MessageType, IMessageHandler MessageHandler)> CreateMessageHandler((Type handlerType, Type HandlerInterface, IMessageHandlerFactory Factory) input)
    {
        foreach (var messageHandlerDescription in input.Factory.GetMessageHandlerDescriptions(input.handlerType, input.HandlerInterface))
        {
            var handler = input.Factory.Create(messageHandlerDescription);
            yield return (messageHandlerDescription.MessageType, handler);
        }
    }
}