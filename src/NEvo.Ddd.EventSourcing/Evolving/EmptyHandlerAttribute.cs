namespace NEvo.Ddd.EventSourcing.Evolving;

[AttributeUsage(AttributeTargets.Method, Inherited = false, AllowMultiple = false)]
public sealed class EmptyHandlerAttribute() : Attribute
{
}