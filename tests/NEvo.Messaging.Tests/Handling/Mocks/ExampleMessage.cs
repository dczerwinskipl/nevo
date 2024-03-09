namespace NEvo.Messaging.Tests.Handling.Mocks;

public record ExampleMessage : Message
{
    public ExampleMessage()
    {
    }

    public ExampleMessage(Guid Id, DateTime CreatedAt) : base(Id, CreatedAt)
    {
    }
}
