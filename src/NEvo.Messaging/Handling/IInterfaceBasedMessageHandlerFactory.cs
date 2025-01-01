namespace NEvo.Messaging.Handling;

public interface IInterfaceBasedMessageHandlerFactory : IMessageHandlerFactory
{
    public Type ForInterface { get; }
}
