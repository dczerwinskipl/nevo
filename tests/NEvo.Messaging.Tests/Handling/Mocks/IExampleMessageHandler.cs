namespace NEvo.Messaging.Tests.Handling.Mocks;

internal interface IExampleMessageHandler<TMessage> where TMessage : ExampleMessage
{
    void Handle(TMessage message);
}
