using NEvo.Messaging.Cqrs.Events;

namespace NEvo.ExampleApp.ExampleDomain
{
    public record MyEvent : Event
    {
        public string Foo { get; init; }

        public MyEvent(string foo) : base()
        {
            Foo = foo;
        }

        public MyEvent(Guid id, DateTime createdAt, string foo) : base(id, createdAt)
        {
            Foo = foo;
        }
    }
}